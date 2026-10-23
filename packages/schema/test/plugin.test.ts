import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Plugin } from "../src/plugin.js"
import { Project } from "../src/project.js"

describe("Plugin", () => {
  it("brands unrestricted string IDs like the pinned contract", () => {
    expect(Schema.decodeUnknownSync(Plugin.ID)("../local plugin")).toBe("../local plugin")
  })

  it("decodes every pinned source variant and optional failed ID", () => {
    const decode = Schema.decodeUnknownSync(Plugin.Info)
    expect(
      [
        decode({ id: "builtin", source: { type: "builtin" }, status: "active", tui: true }),
        decode({ source: { type: "package", package: "pkg" }, status: "failed", error: "nope", tui: false }),
        decode({ id: "local", source: { type: "local", path: "/tmp/plugin.ts" }, status: "active", tui: false }),
        decode({ id: "sdk", source: { type: "sdk" }, status: "active", tui: false }),
        decode({
          id: "project",
          source: {
            type: "project",
            projectID: Project.ID.make("prj_00000000000000000000000001"),
            path: "plugin/demo.ts",
          },
          status: "active",
          tui: false,
        }),
        decode({
          source: { type: "project", projectID: Project.ID.make("prj_00000000000000000000000002") },
          status: "failed",
          error: "nope",
          tui: false,
        }),
      ].map((info) => info.source.type),
    ).toEqual(["builtin", "package", "local", "sdk", "project", "project"])
  })

  it("rejects removed Account plugin sources", () => {
    expect(() => Schema.decodeUnknownSync(Plugin.Source)({ type: "account", pluginID: "account.example" })).toThrow()
  })

  it("decodes form-backed configuration without exposing plugin implementation", () => {
    expect(
      Schema.decodeUnknownSync(Plugin.Info)({
        id: "builtin",
        source: { type: "builtin" },
        status: "active",
        tui: false,
        configuration: {
          title: "Routing",
          fields: [{ key: "enabled", type: "boolean", default: true }],
          values: { enabled: false },
          configured: true,
        },
      }),
    ).toMatchObject({ configuration: { title: "Routing", values: { enabled: false } } })
  })

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
