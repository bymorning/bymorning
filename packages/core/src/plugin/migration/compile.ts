import { Plugin } from "@bymorning/plugin/effect"
import type { SessionModelRequest } from "@bymorning/plugin/session-hooks"
import { Model } from "@bymorning/schema/model"
import { ModelError } from "@bymorning/schema/plugin-model"
import type { Archive } from "@bymorning/schema/plugin-migration"
import { PolicySchema, type Definition } from "@bymorning/schema/policy"
import { Provider } from "@bymorning/schema/provider"
import { SystemPart } from "@opencode-ai/ai/schema/messages"
import { Config, Effect, Schema } from "effect"
import { Wildcard } from "../../wildcard.js"

/** Expected migration incompatibility, reported by Plugin activation rather than silently discarded. */
export class MigrationError extends Schema.TaggedError<MigrationError>()("Plugin.MigrationError", { message: Schema.String }) {}

const resource = (model: Model.Ref) => `${model.provider}/${model.id}${model.variant === undefined || model.variant === "default" ? "" : `#${model.variant}`}`
const model = (value: string) => {
  const slash = value.indexOf("/")
  const hash = value.indexOf("#", slash)
  return Schema.decodeUnknownEffect(Model.Ref)({
    provider: value.slice(0, slash), id: value.slice(slash + 1, hash < 0 ? undefined : hash),
    ...(hash < 0 || value.slice(hash + 1) === "default" ? {} : { variant: value.slice(hash + 1) }),
  })
}

/** Compile retained Session behavior into specialized callbacks, with no runtime rule registry or generic evaluator. */
export function compile(definitions: readonly Definition[], archive: Archive) {
  return Plugin.define({
    id: "bymorning.migrated",
    scope: "workspace",
    configuration: {
      title: "Migrated Session behavior",
      description: "Retained definitions are archived. These switches control compiled Session callbacks. Review the conversion export before enabling previously disabled definitions.",
      fields: [
        { key: "active", type: "boolean", title: "Enable migrated callbacks", default: true },
        ...definitions.map((definition) => ({
          key: `enabled:${definition.id}`, type: "boolean" as const, title: definition.name,
          default: definition.enabled !== false && !archive.suppressions.some((entry) => entry.key === `suppressed/${definition.id}` && entry.value === true),
        })),
      ],
    },
    effect: (context) => Effect.gen(function* () {
      if (archive.report.some((entry) => entry.status === "invalid"))
        return yield* new MigrationError({ message: "Retained definitions contain invalid data. Download the migration export before repair." }).pipe(Effect.orDie)
      if (context.options.active === false) return
      const active = definitions.filter((definition) => context.options[`enabled:${definition.id}`] !== false &&
        (context.options[`enabled:${definition.id}`] === true || (definition.enabled !== false && !archive.suppressions.some((entry) => entry.key === `suppressed/${definition.id}` && entry.value === true))))
      const blocked = archive.report.find((entry) => active.some((definition) => definition.id === entry.id) && entry.rules.some((rule) => rule.status === "unsupported"))
      if (blocked !== undefined)
        return yield* new MigrationError({ message: `Retained definition ${blocked.id} requires an explicit replacement; see the migration export.` }).pipe(Effect.orDie)

      // These arrays are activation-local compiled inputs, never an authorable registry.
      const routes = active.flatMap((definition) => definition.rules.filter((rule) => rule.type === "route"))
      const endpoints = active.flatMap((definition) => definition.rules.filter((rule) => rule.type === "endpoint"))
      const prompts = active.flatMap((definition) => definition.rules.flatMap((rule) => {
        if (rule.type !== "prompt") return []
        const compiled = PolicySchema.compile(rule.match)
        return compiled === undefined ? [] : [{ expression: new RegExp(compiled.source, `${compiled.flags}g`), replacement: rule.replacement }]
      }))
      const instructions = active.flatMap((definition) => definition.rules.filter((rule) => rule.type === "instruction"))
      const guards = active.flatMap((definition) => definition.rules.filter((rule) => rule.type === "guardrail"))
      const modelRequests = guards.filter((rule) => Wildcard.match("model.request", rule.action))
      const providerRequests = guards.filter((rule) => Wildcard.match("provider.request", rule.action))
      const modelUses = guards.filter((rule) => Wildcard.match("model.use", rule.action))
      const providerUses = guards.filter((rule) => Wildcard.match("provider.use", rule.action))

      if (modelUses.length > 0 || providerUses.length > 0) yield* context.session.hook("model.invoke", (input) => Effect.gen(function* () {
        const provider = providerUses.findLast((rule) => Wildcard.match(input.model.provider, rule.resource))
        const selected = modelUses.findLast((rule) => Wildcard.match(resource(input.model), rule.resource))
        const denied = provider?.effect === "deny" ? provider : selected?.effect === "deny" ? selected : undefined
        if (denied !== undefined) return yield* new ModelError({ reason: "denied", message: denied.message ?? "Model invocation denied by migrated Plugin." })
      }))

      if (prompts.length > 0) yield* context.session.hook("prompt", (input) => Effect.sync(() => {
        for (const prompt of prompts) input.prompt.text = input.prompt.text.replace(prompt.expression, prompt.replacement)
      }))
      if (instructions.length > 0) yield* context.session.hook("context", (input) => Effect.sync(() => {
        const selected = resource(input.model)
        for (const instruction of instructions)
          if (Wildcard.match(selected, instruction.model) && (instruction.agent === undefined || Wildcard.match(input.agent, instruction.agent)))
            input.system.push(SystemPart.make(instruction.text))
      }))
      if (routes.length > 0 || endpoints.length > 0 || modelRequests.length > 0 || providerRequests.length > 0) yield* context.session.hook("model.request", Effect.fn("Plugin.migratedRequest")(function* (input: SessionModelRequest) {
        // Legacy routing selected the last match against one original selector, not a chain of rewritten selectors.
        const modelGuard = modelRequests.findLast((rule) => Wildcard.match(resource(input.requestedModel), rule.resource))
        if (modelGuard?.effect === "deny") return yield* new ModelError({ reason: "denied", message: modelGuard.message ?? "Model request denied by migrated Plugin." }).pipe(Effect.orDie)
        const selected = routes.findLast((route) => route.action === "model.request" && Wildcard.match(resource(input.requestedModel), route.resource))
        if (selected !== undefined) input.model = yield* model(selected.target).pipe(Effect.orDie)
        const providerKey = `${input.model.id}${input.model.variant === undefined || input.model.variant === "default" ? "" : `#${input.model.variant}`}`
        const providerGuard = providerRequests.findLast((rule) => Wildcard.match(providerKey, rule.resource))
        if (providerGuard?.effect === "deny") return yield* new ModelError({ reason: "denied", message: providerGuard.message ?? "Provider request denied by migrated Plugin." }).pipe(Effect.orDie)
        const provider = routes.findLast((route) => route.action === "provider.request" && Wildcard.match(providerKey, route.resource))
        if (provider !== undefined) input.model = { ...input.model, provider: yield* Schema.decodeUnknownEffect(Provider.Name)(provider.target).pipe(Effect.orDie) }
        const endpoint = endpoints.findLast((entry) => Wildcard.match(resource(input.model), entry.model))
        if (endpoint === undefined) return
        if (endpoint.baseURL !== undefined) input.baseURL = endpoint.baseURL
        for (const [name, value] of Object.entries(endpoint.headers ?? {})) {
          const resolved = typeof value === "string" ? value : yield* Config.string(value.env).pipe(
            Effect.mapError(() => new MigrationError({ message: "A retained endpoint header environment variable is unavailable." })), Effect.orDie,
          )
          if (resolved.length === 0 && typeof value !== "string")
            return yield* new MigrationError({ message: "A retained endpoint header environment variable is empty." }).pipe(Effect.orDie)
          input.headers[name] = resolved
        }
      }))
    }),
  })
}
