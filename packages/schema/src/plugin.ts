export * as Plugin from "./plugin.js"
export * as PluginSchema from "./plugin.js"

import { Schema } from "effect"
import { Event as EventSchema } from "./event.js"
import { Form } from "./form.js"
import { optional } from "./schema.js"
import { Project } from "./project.js"
import { Integration } from "./integration.js"
import * as ProjectDirectorySchema from "./project-directory.js"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

/** A required Plugin contribution could not be activated. */
export class ActivationError extends Schema.TaggedError<ActivationError>()("Plugin.ActivationError", {
  pluginID: ID,
  message: Schema.String,
}) {}

/** Owning activation lifetime; omitted declarations retain member hosting. */
export const Scope = Schema.Literals(["workspace", "member"])
/** Owning activation lifetime. */
export type Scope = typeof Scope.Type

export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin") }),
  Schema.Struct({
    type: Schema.Literal("package"),
    package: Schema.String,
    version: Schema.optionalKey(Schema.String),
    outdated: Schema.optionalKey(Schema.Literal(true)),
    updating: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({ type: Schema.Literal("local"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sdk") }),
  Schema.Struct({
    type: Schema.Literal("project"),
    projectID: Project.ID,
    path: Schema.optionalKey(ProjectDirectorySchema.Path),
  }),
]).annotate({ identifier: "Plugin.Source" })
export type Source = typeof Source.Type

export const OptionSets = Schema.Record(Schema.String, Schema.Array(Form.Option)).annotate({
  identifier: "Plugin.OptionSets",
})
export type OptionSets = typeof OptionSets.Type

export const ConfigurationStringField = Schema.Struct({
  ...Form.StringField.fields,
  secret: Schema.Literal(false).pipe(optional),
  optionsKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Plugin.ConfigurationStringField" })
export interface ConfigurationStringField extends Schema.Schema.Type<typeof ConfigurationStringField> {}

export const ConfigurationField = Schema.Union([
  ConfigurationStringField,
  Form.NumberField,
  Form.IntegerField,
  Form.BooleanField,
  Form.MultiselectField,
]).pipe(Schema.toTaggedUnion("type"), Schema.annotate({ identifier: "Plugin.ConfigurationField" }))
export type ConfigurationField = typeof ConfigurationField.Type
export const ConfigurationFields = Schema.NonEmptyArray(ConfigurationField).annotate({
  identifier: "Plugin.ConfigurationFields",
})
export type ConfigurationFields = typeof ConfigurationFields.Type

/** Non-secret Workspace configuration declared by a Plugin. */
export const ConfigurationDefinition = Schema.Struct({
  title: Schema.String,
  description: Schema.String.pipe(optional),
  fields: ConfigurationFields,
  optionSets: OptionSets.pipe(optional),
}).annotate({ identifier: "Plugin.ConfigurationDefinition" })
export interface ConfigurationDefinition extends Schema.Schema.Type<typeof ConfigurationDefinition> {}

/** Form-backed configuration exposed for one active Plugin. */
export const Configuration = Schema.Struct({
  ...ConfigurationDefinition.fields,
  values: Form.Answer,
  configured: Schema.Boolean,
}).annotate({ identifier: "Plugin.Configuration" })
export interface Configuration extends Schema.Schema.Type<typeof Configuration> {}

/** Resolve configuration-local option references into ordinary form fields. */
export function resolveFields(fields: ReadonlyArray<ConfigurationField>, optionSets: OptionSets = {}): Form.Field[] {
  return fields.map((field) => {
    if (field.type !== "string" || field.optionsKey === undefined) return field
    return { ...field, options: field.options ?? optionSets[field.optionsKey] ?? [] }
  })
}

/** Validate option references independently of submitted answers. */
export function validateOptionSets(fields: ReadonlyArray<ConfigurationField>, optionSets: OptionSets = {}) {
  for (const field of fields) {
    if (field.type !== "string" || field.optionsKey === undefined) continue
    if (field.options !== undefined) return `Form field cannot declare options and optionsKey: ${field.key}`
    if (optionSets[field.optionsKey] === undefined) return `Missing option set: ${field.optionsKey}`
  }
}
const OptionalConfiguration = Configuration.pipe(optional)

export const Info = Schema.Union([
  Schema.Struct({
    id: ID,
    source: Source,
    status: Schema.Literal("active"),
    scope: Scope.pipe(optional),
    tui: Schema.Boolean,
    configuration: OptionalConfiguration,
    integrations: Schema.Array(Integration.ID).pipe(optional),
    tools: Schema.Array(Schema.String).pipe(optional),
  }),
  Schema.Struct({
    id: ID.pipe(optional),
    source: Source,
    status: Schema.Literal("failed"),
    scope: Scope.pipe(optional),
    error: Schema.String,
    /** Correlates a redacted inventory failure with the server log entry carrying the full cause. */
    ref: Schema.String.pipe(optional),
    tui: Schema.Boolean,
    configuration: OptionalConfiguration,
    integrations: Schema.Array(Integration.ID).pipe(optional),
    tools: Schema.Array(Schema.String).pipe(optional),
  }),
]).annotate({ identifier: "Plugin.Info" })
export type Info = typeof Info.Type

const Added = EventSchema.define("plugin.added", { id: ID })
export const Updated = EventSchema.define("plugin.updated", {})
export const Event = { Added, Updated, Definitions: EventSchema.inventory(Added, Updated) }
