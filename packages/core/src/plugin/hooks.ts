export * as PluginHooks from "./hooks.js"

import type { ToolFailures, ToolHooks } from "@bymorning/plugin/effect/tool"
import type { GatewayFailures, GatewayHooks } from "@bymorning/plugin/effect/gateway"
import type { ShellHooks } from "@bymorning/plugin/effect/shell"
import type { SessionHooks } from "@bymorning/plugin/effect/session"
import type { Registration } from "@bymorning/plugin/effect/registration"
import type { ModelHookOptions } from "@bymorning/plugin/effect/registration"
import { Context, Effect, Latch, Layer, Scope, Semaphore } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/effect/model"
import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import { admit, lifetime, observe } from "./invocation.js"
import type { Invocation } from "./invocation.js"

export type { Invocation } from "./invocation.js"

/** Owner-specific final facts for one physical inference attempt. */
export type InvocationInput =
  | { readonly domain: "session"; readonly event: SessionInput }
  | { readonly domain: "gateway"; readonly event: GatewayInput }

interface InvocationEvent {
  readonly session: SessionInvocation
  readonly gateway: GatewayInvocation
}

export interface Domains {
  readonly gateway: GatewayHooks
  readonly session: SessionHooks
  readonly shell: ShellHooks
  readonly tool: ToolHooks
}

interface Failures extends Record<keyof Domains, unknown> {
  readonly gateway: GatewayFailures
  readonly session: Record<keyof SessionHooks, never>
  readonly shell: Record<keyof ShellHooks, never>
  readonly tool: ToolFailures
}

type Callback<Event, Error> = (event: Event) => Effect.Effect<void, Error>
type Entry = { readonly callback: (event: never) => Effect.Effect<void, unknown, Scope.Scope>; readonly options?: ModelHookOptions }

/** Activation-scoped callback registration, with invocation-specific execution requirements. */
export interface Register {
  <Domain extends keyof InvocationEvent>(
    domain: Domain,
    name: "model.invoke",
    callback: (event: InvocationEvent[Domain]) => Effect.Effect<void, ModelError, Scope.Scope>,
  ): Effect.Effect<Registration, never, Scope.Scope>
  <Domain extends keyof Domains, Name extends keyof Domains[Domain] & keyof Failures[Domain]>(
    domain: Domain,
    name: Name,
    callback: Callback<Domains[Domain][Name], Failures[Domain][Name]>,
    options?: ModelHookOptions,
  ): Effect.Effect<Registration, never, Scope.Scope>
}

export interface Interface {
  readonly register: Register
  readonly trigger: <Domain extends keyof Domains, Name extends keyof Domains[Domain] & keyof Failures[Domain]>(
    domain: Domain,
    name: Name,
    event: Domains[Domain][Name],
  ) => Effect.Effect<Domains[Domain][Name], Failures[Domain][Name]>
  readonly has: <Domain extends keyof Domains>(domain: Domain, name: keyof Domains[Domain] | (Domain extends keyof InvocationEvent ? "model.invoke" : never), providerID?: string) => boolean
  /** Admit one attempt in the caller's request Scope. */
  readonly open: (input: InvocationInput) => Effect.Effect<Invocation, ModelError, Scope.Scope>
  /** Block admission, drain active lifetimes, replace activation, then reopen admission. */
  readonly drain: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginHooks") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const callbacks = new Map<string, Entry[]>()
    const admission = yield* Latch.make(true)
    const idle = yield* Latch.make(true)
    const reload = yield* Semaphore.make(1)
    let active = 0
    const key = (domain: keyof Domains, name: PropertyKey) => `${domain}.${String(name)}`

    const register = Effect.fn("PluginHooks.register")(function* (
      domain: keyof Domains,
      name: PropertyKey,
      callback: Entry["callback"],
      options?: ModelHookOptions,
    ) {
      const scope = yield* Scope.Scope
      const id = key(domain, name)
      let active = true
      const entry = { callback, options }
      callbacks.set(id, [...(callbacks.get(id) ?? []), entry])
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        const next = (callbacks.get(id) ?? []).filter((item) => item !== entry)
        if (next.length === 0) callbacks.delete(id)
        else callbacks.set(id, next)
      })
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    }) as Register

    const trigger = Effect.fnUntraced(function* <
      Domain extends keyof Domains,
      Name extends keyof Domains[Domain] & keyof Failures[Domain],
    >(domain: Domain, name: Name, event: Domains[Domain][Name]) {
      for (const entry of callbacks.get(key(domain, name)) ?? []) {
        if (entry.options?.providerID !== undefined && providerOf(event) !== entry.options.providerID) continue
        // The registration key preserves this correlation in the heterogeneous registry.
        const result = (entry.callback as Callback<Domains[Domain][Name], Failures[Domain][Name]>)(event)
        yield* result
      }
      return event
    })

    const has = ((domain, name, providerID) =>
      (callbacks.get(key(domain, name)) ?? []).some((entry) =>
        providerID === undefined || entry.options?.providerID === undefined || entry.options.providerID === providerID,
      )) as Interface["has"]
    const open = Effect.fn("PluginHooks.open")((input: InvocationInput) => Effect.suspend(() => {
      let counted = false
      const released = Effect.sync(() => {
        if (!counted) return
        active--
        if (active === 0) idle.openUnsafe()
      })
      return lifetime((scope) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
        while (!admission.isOpen()) yield* restore(admission.await)
        active++
        counted = true
        idle.closeUnsafe()
        const captured = [...(callbacks.get(key(input.domain, "model.invoke")) ?? [])]
        const event = Object.freeze({ ...input.event, model: Object.freeze({ ...input.event.model }) })
        return yield* restore(admit(scope, captured.map((entry) => (capabilities) => {
          const callback = entry.callback as (event: SessionInvocation | GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>
          return callback(Object.freeze({ ...event, ...capabilities }))
        })))
      })), released)
    }))
    const drain = ((effect) => reload.withPermit(Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        admission.closeUnsafe()
        return yield* restore(idle.await.pipe(Effect.andThen(effect))).pipe(Effect.ensuring(admission.open))
      }),
    ).pipe(Effect.withSpan("PluginHooks.drain", { attributes: { hook: "model.invoke" } })))) as Interface["drain"]
    return Service.of({ register, trigger, has, open, drain })
  }),
)

/** Compose shared Workspace callbacks before member callbacks; registrations remain member-owned. */
export const compose = (workspace: Interface, member: Interface): Interface => ({
  register: member.register,
  has: (domain, name, providerID) => workspace.has(domain, name, providerID) || member.has(domain, name, providerID),
  trigger: (domain, name, event) => workspace.trigger(domain, name, event).pipe(
    Effect.flatMap((event) => member.trigger(domain, name, event)),
  ),
  open: (input) => lifetime((scope) => Effect.gen(function* () {
    const shared = yield* workspace.open(input).pipe(Scope.provide(scope))
    const local = yield* member.open(input).pipe(Scope.provide(scope))
    return { usage: (tokens) => observe([shared.usage(tokens), local.usage(tokens)]) } satisfies Invocation
  })),
  // Member replacement owns only member registrations. Draining workspace here would make a member
  // Config update wait for workspace-only Gateway streams that never touch member resources, deadlocking
  // api.config.update (member reloadAfter) behind a Gateway abort that itself waits for the update to return.
  // Workspace reload still drains workspace hooks through its own registry, waiting for Gateway and Session.
  // Session attempts increment both registries via open above, so draining member still waits for Session.
  drain: (effect) => member.drain(effect),
})

/** Canonical workspace-local plugin hook registry. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [] })

const providerOf = (event: unknown) => {
  if (typeof event !== "object" || event === null || !("model" in event)) return undefined
  const model = event.model
  if (typeof model !== "object" || model === null || !("provider" in model)) return undefined
  return typeof model.provider === "string" ? model.provider : undefined
}
