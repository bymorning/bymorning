/** Toolkit Plugin inventory Tool: lets the model see activation outcomes, including failures. */
import type { Context } from "@bymorning/plugin/effect/plugin"
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { Integration } from "@bymorning/schema/integration"
import { Plugin } from "@bymorning/schema/plugin"
import { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Effect, Schema } from "effect"
import { operational } from "./toolkit-shared.js"

export const PluginNamespace = "toolkit.plugin" as const

const SourceType = Schema.Literals(["builtin", "package", "local", "sdk", "project"])
const Status = Schema.Literals(["active", "failed"])

const ListInput = Schema.Struct({
  source: Schema.optionalKey(SourceType).annotate({
    description: "Only plugins from this source type; `project` is the current Project's `plugin/` directory",
  }),
  status: Schema.optionalKey(Status).annotate({ description: "Only plugins with this activation status" }),
})

/** Secret-free, path-free projection of `Plugin.Source`: Project paths stay Project-relative. */
const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin") }),
  Schema.Struct({
    type: Schema.Literal("package"),
    package: Schema.String,
    version: Schema.optionalKey(Schema.String),
    outdated: Schema.optionalKey(Schema.Literal(true)),
    updating: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({ type: Schema.Literal("local") }),
  Schema.Struct({ type: Schema.Literal("sdk") }),
  Schema.Struct({
    type: Schema.Literal("project"),
    projectID: Project.ID,
    path: Schema.optionalKey(ProjectDirectory.Path),
  }),
]).pipe(Schema.toTaggedUnion("type"))

const Row = Schema.Struct({
  id: Schema.optionalKey(Plugin.ID),
  source: Source,
  status: Status,
  error: Schema.optionalKey(Schema.String),
  ref: Schema.optionalKey(Schema.String),
  integrations: Schema.optionalKey(Schema.Array(Integration.ID)),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
})
const PluginList = Schema.Struct({ plugins: Schema.Array(Row) })

const source = (value: Plugin.Source): typeof Source.Type => {
  switch (value.type) {
    case "local":
      // A configured local entrypoint is a host filesystem path; the model has no use for it.
      return { type: "local" }
    default:
      return value
  }
}

/** Project the inventory for the model: identity, origin, outcome, and contributions; never host paths. */
export const row = (info: Plugin.Info): typeof Row.Type => ({
  ...(info.id === undefined ? {} : { id: info.id }),
  source: source(info.source),
  status: info.status,
  ...(info.status === "failed" ? { error: info.error, ...(info.ref === undefined ? {} : { ref: info.ref }) } : {}),
  ...(info.integrations === undefined ? {} : { integrations: info.integrations }),
  ...(info.tools === undefined ? {} : { tools: info.tools }),
})

export const registerPluginTools = (editor: ToolEditor, host: Pick<Context, "plugin">) => {
  const { plugin } = host

  editor.namespace({
    name: PluginNamespace,
    description:
      "Use after writing or editing a Project plugin under `plugin/`, or when the user asks why a plugin, Tool, or Integration is missing, to read the plugin inventory with each activation status and error.",
  })
  editor.add({
    name: "list",
    description:
      'Use when the user wants the plugin inventory or after writing a Project plugin: every plugin with its `source`, `status` (`active` or `failed`), redacted `error` and log `ref` on failure, and the Integration IDs and Tool names an active plugin contributed. Filter with `source: "project"` for the current Project\'s `plugin/` entrypoints.',
    input: ListInput,
    output: PluginList,
    options: { ...operational("plugin_list", PluginNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "plugin_list", resources: ["plugin"] })
        const inventory = yield* plugin.list()
        const plugins = inventory
          .filter((info) => input.source === undefined || info.source.type === input.source)
          .filter((info) => input.status === undefined || info.status === input.status)
          .map(row)
        return { output: { plugins } }
      }),
  })
}
