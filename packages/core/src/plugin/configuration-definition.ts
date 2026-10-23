import { Form } from "@bymorning/schema/form"
import { Plugin } from "@bymorning/schema/plugin"
import { Schema } from "effect"
import { validateFields } from "../form.js"

type Resolution =
  { readonly error: string } | { readonly definition: Plugin.ConfigurationDefinition; readonly fields: Form.Field[] }

/** Decode and resolve the one configuration-definition shape accepted by Core. */
export function resolveConfigurationDefinition(input: unknown): Resolution {
  const definition = Schema.decodeUnknownOption(Plugin.ConfigurationDefinition)(input)
  if (definition._tag === "None") return { error: "Plugin configuration cannot contain external or secret fields" }
  const fields = Plugin.resolveFields(definition.value.fields, definition.value.optionSets)
  const error =
    Plugin.validateOptionSets(definition.value.fields, definition.value.optionSets) ?? validateFields(fields)
  if (error !== undefined) return { error }
  return { definition: definition.value, fields }
}
