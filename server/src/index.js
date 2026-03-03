require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { connectToDatabase } = require("./db/connection");
const { initializeCollection } = require("./models/UserConnection");
const { requireAuth } = require("./middleware/auth");
const { generalLimiter, authLimiter } = require("./middleware/rateLimiter");

// Import routes
const authRoutes = require("./routes/auth");
const queryRoutes = require("./routes/query");
const voiceRoutes = require("./routes/voice");
const schemaRoutes = require("./routes/schema");
const dashboardRoutes = require("./routes/dashboard");
const connectionsRoutes = require("./routes/connections");

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Trust proxy for rate limit headers (if behind HEROKU/Vercel/Nginx etc)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow all origins
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser()); // Parses 'am_token' cookie into req.cookies

// Request logger (dev only)
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.path}`);
    next();
  });
}

// Ensure uploads dir exists for multer temp files
const uploadsDir = path.join(__dirname, "..", "uploads");
const fs = require("fs");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Apply general rate limiter to all API requests
app.use("/api/", generalLimiter);

// ---------------------------------------------------------------------------
// Public Routes (no auth required)
// ---------------------------------------------------------------------------

// Apply stricter rate limits to auth-related public routes
app.use("/api/auth", authLimiter, authRoutes); // GET /api/auth/me, POST /api/auth/logout
app.use("/api/connections", authLimiter, connectionsRoutes); // POST /api/connections/connect

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------------------
// Protected Routes (require valid JWT cookie)
// ---------------------------------------------------------------------------
app.use("/api/query", requireAuth, queryRoutes);
app.use("/api/voice", requireAuth, voiceRoutes);
app.use("/api/schema", requireAuth, schemaRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "not_found", message: "Endpoint not found" },
  });
});

app.use((err, _req, res, _next) => {
  console.error("❌ Unhandled error:", err);
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

    app.listen(PORT, () => {
      console.log(`\n🚀 AtlasMind server running on http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`   Health:      http://localhost:${PORT}/api/health\n`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
