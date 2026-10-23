/** Toolkit policy Tools. */
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { Actor } from "../../../actor.js"
import { ConfigSchema } from "@bymorning/schema/config"
import { ConfigGateway } from "@bymorning/schema/config/gateway"
import { Permission } from "@bymorning/schema/permission"
import { NonNegativeInt, optional } from "@bymorning/schema/schema"
import { Effect, Schema } from "effect"
import type { Interface as ConfigInterface } from "../../../config.js"
import { Tool } from "../../../tool.js"
import { PolicyNamespace, operational } from "./toolkit-shared.js"

const GatewayPatch = Schema.Struct({
  rpm: Schema.optionalKey(NonNegativeInt),
  tpm: Schema.optionalKey(NonNegativeInt),
  models: Schema.optionalKey(Schema.Array(Schema.String)),
})

const UpdateInput = Schema.Struct({
  gateway: Schema.optionalKey(GatewayPatch),
  permissions: Schema.optionalKey(Permission.Ruleset),
  providers: Schema.optionalKey(ConfigSchema.Providers),
  routing: Schema.optionalKey(Schema.Array(ConfigSchema.Routing)),
})

const PolicyOutput = Schema.Struct({
  gateway: ConfigGateway.Info.pipe(optional),
  permissions: Permission.Ruleset,
  providers: ConfigSchema.Providers.pipe(optional),
  routing: Schema.Array(ConfigSchema.Routing).pipe(optional),
})

const policy = (info: ConfigSchema.Info) => ({
  ...(info.gateway === undefined ? {} : { gateway: info.gateway }),
  permissions: info.permissions,
  ...(info.providers === undefined ? {} : { providers: info.providers }),
  ...(info.routing === undefined ? {} : { routing: info.routing }),
})

export const registerPolicyTools = (
  editor: ToolEditor,
  config: ConfigInterface,
  /** The session member's verified identity; Config applies the administrator rule to it. */
  actor: Actor.Info,
  /** Validates routing rules before they are saved; the same check the Workspace Config API applies. */
  check?: (rules: ReadonlyArray<ConfigSchema.Routing>) => Effect.Effect<void, { readonly issues: ReadonlyArray<{ readonly rule: number; readonly message: string }> }>,
) => {
  editor.namespace({
    name: PolicyNamespace,
    description:
      "Use when the user wants to read or update inference policy: gateway RPM, TPM, model allowlist, Provider allowlist, Routing, and Permission rules.",
  })
  editor.add({
    name: "get",
    description:
      "Use when the user wants to read gateway RPM, TPM, model allowlist, Provider allowlist, Routing, and Permission rules.",
    input: Schema.Struct({}),
    output: PolicyOutput,
    options: { ...operational("config_get", PolicyNamespace) },
    execute: (_input, toolContext) =>
      Effect.gen(function* () {
        const output = policy(yield* config.get)
        yield* toolContext.permission({
          action: "config_get",
          resources: [
            ...(output.gateway === undefined ? [] : ["gateway"]),
            "permissions",
            ...(output.providers === undefined ? [] : ["providers"]),
            ...(output.routing === undefined ? [] : ["routing"]),
          ],
        })
        return { output }
      }),
  })
  editor.add({
    name: "update",
    description:
      "Use when the user wants to change gateway RPM, TPM, model allowlist, Provider allowlist, Routing, or Permission rules.",
    input: UpdateInput,
    output: PolicyOutput,
    options: { ...operational("config_update", PolicyNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        if (
          input.gateway === undefined &&
          input.permissions === undefined &&
          input.providers === undefined &&
          input.routing === undefined
        )
          return yield* new Tool.Error({ message: "Provide gateway, permissions, providers, or routing" })
        const resources = [
          ...(input.gateway === undefined ? [] : ["gateway"]),
          ...(input.permissions === undefined ? [] : ["permissions"]),
          ...(input.providers === undefined ? [] : ["providers"]),
          ...(input.routing === undefined ? [] : ["routing"]),
        ]
        yield* toolContext.permission({ action: "config_update", resources })
        if (input.routing !== undefined && check !== undefined)
          yield* check(input.routing).pipe(
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message: error.issues.map((issue) => `Routing rule ${issue.rule + 1}: ${issue.message}`).join("; "),
                }),
            ),
          )
        const current = yield* config.get
        const stored = yield* Schema.encodeEffect(ConfigSchema.Info)(current).pipe(
          Effect.mapError(() => new Tool.Error({ message: "Workspace configuration could not be encoded" })),
        )
        const gateway =
          input.gateway === undefined
            ? stored.gateway
            : {
                ...stored.gateway,
                ...(input.gateway.rpm === undefined && input.gateway.tpm === undefined
                  ? {}
                  : {
                      limits: {
                        ...stored.gateway?.limits,
                        ...(input.gateway.rpm === undefined ? {} : { rpm: input.gateway.rpm }),
                        ...(input.gateway.tpm === undefined ? {} : { tpm: input.gateway.tpm }),
                      },
                    }),
                ...(input.gateway.models === undefined ? {} : { models: input.gateway.models }),
              }
        const updated = yield* config
          .update(
            {
              ...stored,
              ...(gateway === undefined ? {} : { gateway }),
              ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
              ...(input.providers === undefined ? {} : { providers: input.providers }),
              ...(input.routing === undefined ? {} : { routing: input.routing }),
            },
            actor,
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof Actor.ForbiddenError
                ? new Tool.Error({ message: error.message })
                : new Tool.Error({ message: "Workspace configuration could not be updated" }),
            ),
          )
        return { output: policy(updated) }
      }),
  })
}
