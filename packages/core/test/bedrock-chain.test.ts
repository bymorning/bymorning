import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

for (const mode of ["container", "web-identity"]) test(`Integration selects ${mode} credentials automatically and refreshes them for each native signature`, async ({
  signal,
}) => {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AWS_")))
  const { stdout } = await promisify(execFile)(
    "bun",
    [fileURLToPath(new URL("./fixtures/bedrock-chain.ts", import.meta.url))],
    {
      signal,
      env: {
        ...environment,
        BEDROCK_CHAIN_MODE: mode,
        AWS_REGION: "eu-west-1",
        AWS_EC2_METADATA_DISABLED: "true",
        AWS_CONFIG_FILE: "/dev/null",
        AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
      },
    },
  )
  expect(stdout).toContain("Integration deployment selection and refreshed Converse/Mantle signatures passed")
}, 30_000)
