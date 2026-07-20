import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: [
      "convex/**/*.test.ts",
      "apps/mobile/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "shared/**/*.test.ts",
    ],
  },
});
