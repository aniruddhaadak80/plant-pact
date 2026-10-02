import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120000,
    // PGlite compiles Postgres to WebAssembly on first use, so the first
    // repository initialisation is genuinely slow.
    hookTimeout: 180000,
    teardownTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});