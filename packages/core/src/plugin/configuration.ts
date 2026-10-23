export * as PluginConfiguration from "./configuration.js"

import { Form } from "@bymorning/schema/form"
import { Plugin } from "@bymorning/schema/plugin"
import { Context, Effect, Exit, MutableRef, Option, Schema } from "effect"
import { Config } from "../config.js"
import { Service } from "../plugin.js"
import { resolveConfigurationDefinition } from "./configuration-definition.js"
import { configurationTarget } from "./source-target.js"
import { PluginSupervisor } from "./supervisor-service.js"
import { Binding } from "./workspace-runtime.js"

export class InvalidError extends Schema.TaggedError<InvalidError>()("PluginConfiguration.InvalidError", {
  message: Schema.String,
}) {}

export class ActivationError extends Schema.TaggedError<ActivationError>()("PluginConfiguration.ActivationError", {}) {}

/** Persist, activate, and verify one form-configured Workspace plugin. */
export const configure = Effect.fn("PluginConfiguration.configure")(function* (
  pluginID: Plugin.ID,
  payload: Form.Answer,
) {
  const plugins = yield* Service
  const current = (yield* plugins.list()).find((plugin) => plugin.id === pluginID && plugin.configuration !== undefined)
  if (current?.configuration === undefined)
    return yield* new InvalidError({ message: `Plugin is not configurable: ${pluginID}` })
  if (configurationTarget(current.source, pluginID) === undefined)
    return yield* new InvalidError({ message: `Plugin source is not Workspace-configurable: ${pluginID}` })

  const configuration = resolveConfigurationDefinition(current.configuration)
  if ("error" in configuration) return yield* new InvalidError({ message: configuration.error })
  const unknown = Object.keys(payload).find((key) => !configuration.fields.some((field) => field.key === key))
  if (unknown !== undefined) return yield* new InvalidError({ message: `Unknown form field: ${unknown}` })
  const normalized = Form.normalize(configuration.fields, {
    ...Form.defaults(configuration.fields),
    ...payload,
  })
  const invalidAnswer = Form.validate(configuration.fields, normalized)
  if (invalidAnswer !== undefined) return yield* new InvalidError({ message: invalidAnswer })

  const config = yield* Config.Service
  const shared = yield* Effect.serviceOption(Binding)
  const supervisor = current.scope === "workspace" && Option.isSome(shared)
    ? Context.get(shared.value, PluginSupervisor.Service)
    : yield* PluginSupervisor.Service
  const compensation = MutableRef.make<Config.PluginCompensation | undefined>(undefined)
  const activation = yield* supervisor
    .reloadAfter(
      config.plugin
        .configure(current.source, pluginID, normalized)
        .pipe(Effect.tap((value) => Effect.sync(() => MutableRef.set(compensation, value)))),
    )
    .pipe(Effect.exit)
  const configured = Exit.isSuccess(activation)
    ? (yield* plugins.list()).find(
        (plugin) =>
          plugin.id === pluginID &&
          plugin.status === "active" &&
          plugin.configuration?.configured === true &&
          Schema.toEquivalence(Plugin.Source)(plugin.source, current.source) &&
          Schema.toEquivalence(Form.Answer)(plugin.configuration.values, normalized),
      )
    : undefined
  if (configured !== undefined) return configured

  const committed = MutableRef.get(compensation)
  if (committed !== undefined) yield* supervisor.reloadAfter(committed.rollback).pipe(Effect.ignore)
  return yield* new ActivationError()
})
