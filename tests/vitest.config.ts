import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@clever/shared": path.resolve(__dirname, "../packages/shared/src"),
    },
  },
});
