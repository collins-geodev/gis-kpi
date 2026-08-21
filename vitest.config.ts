import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig paths so src modules that import shared convex libs
    // (e.g. the report builders) load under vitest too.
    alias: {
      "@convex": path.resolve(__dirname, "convex"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["convex/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["convex/lib/**/*.ts"],
      exclude: ["convex/lib/**/*.test.ts", "convex/lib/sourceRows.ts"],
    },
  },
});
