import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // The engine suites simulate every reference solution and hundreds of random
    // graphs; on a shared CI runner that can pass the 5 s default.
    testTimeout: 30_000,
  },
});
