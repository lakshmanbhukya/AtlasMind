// @ts-check
require("dotenv").config();

const express = require("express");
const cors = require("cors");
// The typings model these as ES default exports; the CommonJS entry is the function itself.
const helmet = /** @type {typeof import("helmet").default} */ (/** @type {unknown} */ (require("helmet")));
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const pinoHttp = /** @type {typeof import("pino-http").default} */ (/** @type {unknown} */ (require("pino-http")));
const { logger } = require("./utils/logger");
const { connectToDatabase, closeConnection } = require("./db/connection");
const { initializeCollection } = require("./models/UserConnection");
const {
  initializeCollection: initializeWorkspaceCollection,
} = require("./models/Workspace");
const {
  initializeCleanupIndexes,
  startCleanupCron,
} = require("./services/cleanupService");
const { requireAuth } = require("./middleware/auth");
const dashboardStore = require("./stores/dashboardStore");
const providerCredentialStore = require("./stores/providerCredentialStore");
const { originCheck } = require("./middleware/originCheck");
const { generalLimiter, authLimiter, llmLimiter } = require("./middleware/rateLimiter");
const { cleanupPool, getPoolSize } = require("./services/userDbPool");

// Import routes
const authRoutes = require("./routes/auth");
const queryRoutes = require("./routes/query");
const voiceRoutes = require("./routes/voice");
const schemaRoutes = require("./routes/schema");
const dashboardRoutes = require("./routes/dashboard");
const connectionsRoutes = require("./routes/connections");
const workspaceRoutes = require("./routes/workspaces");
const scopeSuggestRoutes = require("./routes/scopeSuggest");
const sharedDashboardRoutes = require("./routes/sharedDashboard");
const providerSettingsRoutes = require("./routes/providerSettings");

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  // Allow non-browser clients (curl, health checks) with no Origin header.
  if (!origin) return true;

  // In non-production, preserve permissive behavior for local development.
  if (process.env.NODE_ENV !== "production") return true;

  // In production, require explicit origin allow-list.
  return allowedOrigins.includes(origin);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Trust proxy for rate limit headers (if behind HEROKU/Vercel/Nginx etc)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Structured request logging. Mounted first so every response carries
// X-Request-Id, including ones helmet, CORS or the rate limiters end early.
// An incoming x-request-id is reused only when it is a short safe token.
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;
app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const id =
        typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)
          ? incoming
          : crypto.randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    // The Docker HEALTHCHECK polls this; don't log every hit.
    autoLogging: { ignore: (req) => req.url === "/api/health" },
    // Evaluated again when the response finishes, so the "request completed"
    // line carries the tenant once requireAuth has set it.
    customProps: (req) =>
      req.connectionId ? { connectionId: req.connectionId } : {},
    // Keep access lines short: no request or response headers.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);

// Security headers. The API only returns JSON, so helmet's defaults fit; the
// default Cross-Origin-Resource-Policy only affects no-cors loads, and the
// cross-site client calls the API with CORS requests, so it is unaffected.
app.use(helmet());

// Reject state-changing /api requests from a foreign Origin (403) before CORS,
// so a cross-site page can't spend the managed Groq allowance with the cookie.
app.use("/api/", originCheck);

app.use(
  cors({
    origin: function (origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  }),
);

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser()); // Parses 'am_token' cookie into req.cookies

// Apply general rate limiter to all API requests
app.use("/api/", generalLimiter);

// ---------------------------------------------------------------------------
// Public Routes (no auth required)
// ---------------------------------------------------------------------------

// Apply stricter rate limits to auth-related public routes
app.use("/api/auth", authLimiter, authRoutes); // GET /api/auth/me, POST /api/auth/logout
app.use("/api/connections", authLimiter, connectionsRoutes); // POST /api/connections/connect
app.use("/api/dashboard/shared", sharedDashboardRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    userDbPoolSize: getPoolSize(),
  });
});

// ---------------------------------------------------------------------------
// Protected Routes (require valid JWT cookie)
// ---------------------------------------------------------------------------
app.use("/api/query", requireAuth, llmLimiter, queryRoutes);
app.use("/api/voice", requireAuth, llmLimiter, voiceRoutes);
app.use("/api/schema", requireAuth, schemaRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/workspaces", requireAuth, workspaceRoutes);
app.use("/api/scope", requireAuth, scopeSuggestRoutes);
app.use("/api/provider-settings", requireAuth, providerSettingsRoutes);

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "not_found", message: "Endpoint not found" },
  });
});

app.use((err, req, res, _next) => {
  (req.log || logger).error({ err }, "Unhandled error");
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || "internal_error",
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    await connectToDatabase();
    await initializeCollection();
    await initializeWorkspaceCollection();
    await initializeCleanupIndexes();
    await dashboardStore.initializeIndexes();
    await providerCredentialStore.initializeIndexes();
    startCleanupCron();

    const server = app.listen(PORT, () => {
      logger.info(
        { port: Number(PORT), env: process.env.NODE_ENV || "development" },
        `AtlasMind server listening on http://localhost:${PORT}`,
      );
    });

    // Graceful shutdown (the only signal handler): stop accepting requests,
    // close the user DB pool, then the central DB connection.
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("Shutting down gracefully");
      server.close();
      await cleanupPool();
      await closeConnection();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
