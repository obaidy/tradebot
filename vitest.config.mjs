import { webcrypto } from "node:crypto";
import { defineConfig } from "vitest/config";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setupVitest.ts"],
    globals: true,
    testTimeout: 20000,
  },
});
