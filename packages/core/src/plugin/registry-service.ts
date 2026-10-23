export * as Registry from "./registry-service.js"

import type { Plugin as PluginDefinition } from "@bymorning/plugin/effect/plugin"
import type { PluginOptions } from "@bymorning/plugin/options"
import { Plugin } from "@bymorning/schema/plugin"
import { Cause, Context, Data, Effect, type Exit, Option } from "effect"
import { tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

// The service tag lives apart from the layer so Session entry points can wait on activation without
// importing the registry implementation, which depends on the Workspace host services.
export interface Interface {
  readonly activate: (
    plugins: readonly Generation[],
    failures?: readonly Extract<Plugin.Info, { readonly status: "failed" }>[],
  ) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Plugin.Info[]>
  readonly close: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
  /** Wait for announced updates and activation to settle; failures remain in the inventory. */
  readonly awaitActivation: Effect.Effect<void, ActivationError>
  /** Keep readiness pending while preparing an update. Run the returned Effect to release it. */
  readonly hold: () => Effect.Effect<Effect.Effect<void>>
}

/** A required contribution is absent or failed in the selected activation. */
export const ActivationError = Plugin.ActivationError
/** Required activation failure. */
export type ActivationError = Plugin.ActivationError

/** Application-owned required contribution identities. */
export interface ActivationOptions {
  readonly required?: ReadonlyArray<Plugin.ID>
}

/** Workspace Plugin reload progress. Failed states are projected into inventory. */
export type Status = Data.TaggedEnum<{
  Pending: {}
  Draining: { readonly pluginID?: Plugin.ID; readonly hook?: string }
  Active: {}
  Failed: {
    readonly pluginID?: Plugin.ID
    readonly hook?: string
    readonly error: string
    readonly ref?: string
  }
}>

/** Workspace Plugin reload progress constructors. */
export const Status = Data.taggedEnum<Status>()

/**
 * Build a failed reload status with safe inventory diagnostics.
 *
 * The inventory message never copies credentials, hook inputs, or thrown text.
 * Plugin and hook identity are included when the cause carries them.
 *
 * @param input - The failing cause and the hook that was draining, when known.
 * @returns A Failed status with a log correlation ref.
 */
export const ticketFailed = (input: {
  readonly cause: Cause.Cause<unknown>
  readonly hook?: string
}): Extract<Status, { readonly _tag: "Failed" }> => {
  const ref = `err_${crypto.randomUUID().slice(0, 8)}`
  const pluginID = pluginIDOf(input.cause)
  return Status.Failed({
    error: "Plugin reload failed",
    ref,
    ...(pluginID !== undefined ? { pluginID } : {}),
    ...(input.hook !== undefined ? { hook: input.hook } : {}),
  })
}

/**
 * Project a failed reload ticket into inventory. Other states are not rows.
 *
 * @param status - The in-memory reload ticket.
 * @returns Zero or one failed inventory rows identifying plugin and hook.
 */
export const inventoryStatus = (status: Status): readonly Extract<Plugin.Info, { readonly status: "failed" }>[] => {
  if (status._tag !== "Failed") return []
  const where = [status.pluginID, status.hook].filter((part) => part !== undefined)
  return [
    {
      ...(status.pluginID !== undefined ? { id: status.pluginID } : {}),
      source: { type: "builtin" },
      status: "failed",
      error: where.length === 0 ? status.error : `${status.error} (${where.join(" ")})`,
      ...(status.ref !== undefined ? { ref: status.ref } : {}),
      tui: false,
    },
  ]
}

const pluginIDOf = (cause: Cause.Cause<unknown>): Plugin.ID | undefined => {
  for (const error of [Option.getOrUndefined(Cause.findErrorOption(cause)), Cause.squash(cause)]) {
    if (error === undefined || typeof error !== "object" || error === null || !("pluginID" in error)) continue
    const id = error.pluginID
    if (typeof id === "string" && id.length > 0) return Plugin.ID.make(id)
  }
}

export type Generation = PluginDefinition & {
  readonly revision: string
  readonly source?: Plugin.Source
  readonly options?: PluginOptions
  readonly configured?: boolean
}

/** Workspace-scoped registry of active plugin generations. */
export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

/** Canonical declaration shared by the registry and supervisor without an import cycle. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.workspace, unknown>(
  Service,
  tags.values.workspace,
)

/**
 * Session entry points wait here before reading plugin-provided state such as commands, skills, hooks,
 * and the model catalog. A cold Workspace activates its plugins asynchronously, so without the wait an
 * early request observes an empty registry and admits or fails work the plugins would have shaped.
 */
export const awaitActivation = Service.use((plugins) => plugins.awaitActivation)
