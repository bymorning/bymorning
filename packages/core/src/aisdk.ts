export * as AISDK from "./aisdk.js"

import type { AISDKHooks, AISDKDomain } from "@bymorning/plugin/effect/aisdk"
import type { ModelHookOptions } from "@bymorning/plugin/effect/registration"
import { Context, Effect, Layer, Scope } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"

type Name = keyof AISDKHooks
type Entry<N extends Name = Name> = {
  readonly name: N
  readonly callback: (event: AISDKHooks[N]) => Effect.Effect<void>
  readonly providerID?: string
}

export interface Interface {
  readonly hook: AISDKDomain["hook"]
  readonly run: <N extends Name>(name: N, event: AISDKHooks[N]) => Effect.Effect<AISDKHooks[N]>
}

/** Ordered AI SDK hook registration and execution authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/AISDK") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let entries: readonly Entry[] = []
    const hook = Effect.fn("AISDK.hook")(function* <N extends Name>(
      name: N,
      callback: (event: AISDKHooks[N]) => Effect.Effect<void>,
      options?: ModelHookOptions,
    ) {
      const scope = yield* Scope.Scope
      const entry = { name, callback, providerID: options?.providerID } as Entry
      let active = true
      entries = [...entries, entry]
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        entries = entries.filter((candidate) => candidate !== entry)
      })
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })

    const run = Effect.fn("AISDK.run")(function* <N extends Name>(name: N, event: AISDKHooks[N]) {
      for (const entry of entries) {
        if (entry.name !== name) continue
        if (entry.providerID !== undefined && entry.providerID !== event.model.provider) continue
        yield* Reflect.apply(entry.callback, undefined, [event])
      }
      return event
    })

    return Service.of({ hook, run })
  }),
)

/** Canonical workspace-local AI SDK hook registry. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [] })

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = () => makeWorkspaceNode({ service: Service, layer, deps: [] })
