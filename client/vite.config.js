import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
