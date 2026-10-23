import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One PostgreSQL server per run; the real-boot rows clone its migrated template.
    globalSetup: ["../../packages/testing/src/vitest/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      // The startup contract builds both cloud backends without AWS or Azure:
      // the SDK client modules are replaced wherever they are imported with the
      // recording stand-ins under test/.
      "@aws-sdk/client-s3": fileURLToPath(new URL("./test/aws-sdk-s3.ts", import.meta.url)),
      "@aws-sdk/client-kms": fileURLToPath(new URL("./test/aws-sdk-kms.ts", import.meta.url)),
      "@azure/storage-blob": fileURLToPath(new URL("./test/azure-storage-blob.ts", import.meta.url)),
      "@azure/keyvault-keys": fileURLToPath(new URL("./test/azure-keyvault-keys.ts", import.meta.url)),
    },
  },
})
