import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Plugin } from "../src/plugin.js"

describe("Plugin", () => {
  it("round-trips and resolves configuration-local option sets", () => {
    const configuration = Schema.decodeUnknownSync(Plugin.Configuration)({
      title: "Routing",
      fields: [{ key: "destination", type: "string", default: "target", optionsKey: "models" }],
      optionSets: { models: [{ value: "target", label: "Target" }] },
      values: { destination: "target" },
      configured: true,
    })

    expect(Schema.encodeSync(Plugin.Configuration)(configuration)).toEqual(configuration)
    expect(Plugin.resolveFields(configuration.fields, configuration.optionSets)).toEqual([
      {
        key: "destination",
        type: "string",
        default: "target",
        optionsKey: "models",
        options: [{ value: "target", label: "Target" }],
      },
    ])
  })

  it("round-trips plugin failure references and omits absent references", () => {
    const codec = Schema.fromJsonString(Plugin.Info)
    const failed = {
      source: { type: "package", package: "pkg" },
      status: "failed",
      error: "Plugin failed to load",
      ref: "err_a1b2c3d4",
      tui: false,
    } as const
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(failed))).toEqual(failed)
    expect(Schema.encodeSync(Plugin.Info)({ ...failed, ref: undefined })).toEqual({
      source: failed.source,
      status: "failed",
      error: failed.error,
      tui: false,
    })
    const { ref: _ref, ...unreferenced } = failed
    expect(Schema.decodeUnknownSync(Plugin.Info)(unreferenced)).not.toHaveProperty("ref")
  })

  it("rejects external and secret plugin configuration definitions", () => {
    const decode = Schema.decodeUnknownSync(Plugin.ConfigurationDefinition)
    expect(() => decode({ title: "External", fields: [{ key: "login", type: "external", url: "/login" }] })).toThrow()
    expect(() => decode({ title: "Secret", fields: [{ key: "token", type: "string", secret: true }] })).toThrow()
  })
})
