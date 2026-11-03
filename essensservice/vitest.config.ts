import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Datenbanktests teilen sich eine Test-Datenbank und laufen nacheinander.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
