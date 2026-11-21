import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Dev only: deps reached only through lazy chunks (landing page, app shell)
  // are otherwise discovered late, and the re-optimization serves stale
  // "Outdated Optimize Dep" 504s to the lazy import on a cold start.
  optimizeDeps: {
    include: ["gsap", "gsap/ScrollTrigger", "@gsap/react", "recharts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    },
    // HMR configuration - only for local development
    hmr:
      process.env.NODE_ENV === "development"
        ? {
            host: "localhost",
            port: 5173,
            protocol: "ws",
          }
        : false, // Disable HMR in production
  },
  // Unit tests (Vitest) cover the pure modules in src/; Playwright owns tests/e2e/*.spec.ts.
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
