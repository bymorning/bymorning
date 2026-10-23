import { Effect } from "effect"
import { expect, test } from "vitest"
import { decode } from "./configuration.js"

test("decodes JSONC installation declarations and resolves non-secret resource references", async () => {
  const entry = await Effect.runPromise(
    decode(
      `{
    // Resource values are provided by the installation.
    "plugins": [{ "package": "example", "options": { "identifier": { "env": "RESOURCE" } } }],
    "code_interpreter": { "implementation": "example" },
  }`,
      "/installation/bymorning.jsonc",
      { RESOURCE: "resource-123" },
    ),
  )
  expect(entry.path).toBe("/installation/bymorning.jsonc")
  expect(entry.info.plugins).toEqual([{ package: "example", options: { identifier: "resource-123" } }])
  expect(entry.info.code_interpreter).toEqual({ implementation: "example" })
})

test("refuses malformed JSONC and unresolved references without exposing values", async () => {
  for (const text of ["{invalid", '{"plugins":[{"package":"example","options":{"identifier":{"env":"MISSING"}}}]}']) {
    const result = await Effect.runPromise(decode(text, "/installation/bymorning.jsonc", {}).pipe(Effect.flip))
    expect(result._tag).toBe("Application.ConfigError")
  }
})
