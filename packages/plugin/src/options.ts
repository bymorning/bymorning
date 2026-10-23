import type { Form } from "@bymorning/schema/form"
import type { Plugin } from "@bymorning/schema/plugin"

export type PluginOptions = Readonly<Record<string, unknown>>
export type PluginConfigurationOptionSets = Plugin.OptionSets

/** Non-secret form field supported by persisted Workspace plugin configuration. */
export type PluginConfigurationField =
  | (Omit<Plugin.ConfigurationStringField, "secret"> & { readonly secret?: false })
  | Exclude<Form.Field, Form.StringField | Form.ExternalField>

/** Non-empty form field collection supported by persisted Workspace plugin configuration. */
export type PluginConfigurationFields = readonly [PluginConfigurationField, ...PluginConfigurationField[]]

/** Non-secret Workspace configuration declared by a Plugin. */
export type PluginConfigurationDefinition = Plugin.ConfigurationDefinition
