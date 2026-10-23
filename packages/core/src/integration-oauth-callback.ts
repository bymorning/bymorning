export * as IntegrationOAuthCallback from "./integration-oauth-callback.js"

import type { Account } from "@bymorning/schema/account"
import type { Workspace } from "@bymorning/schema/workspace"
import { Clock, Context, Deferred, Effect, Layer, Scope, SynchronizedRef } from "effect"
import { randomBytes } from "node:crypto"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

const callbackPath = "/auth/integration/callback"

export type ProviderResponse =
  { readonly code: string } | { readonly error: string; readonly errorDescription?: string }

export interface Owner {
  readonly accountID: Account.ID
  readonly workspaceID: Workspace.ID
  readonly pluginID: string
}

export interface Registration {
  readonly state: string
  readonly callbackURI: string
  readonly expiresAt: number
  readonly wait: Effect.Effect<ProviderResponse>
}

export interface Interface {
  /** Registers a host-generated, scoped, one-use browser callback. */
  readonly register: (owner: Owner) => Effect.Effect<Registration, never, Scope.Scope>
  /** Consumes a provider response. Unknown, expired, and replayed states are rejected. */
  readonly deliver: (input: {
    readonly state?: string
    readonly code?: string
    readonly error?: string
    readonly errorDescription?: string
  }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/IntegrationOAuthCallback") {}

/**
 * Process-local rendezvous layer. max=1 does not preserve pending flows across a
 * restart or replacement: deployments invalidate them and users must retry.
 * Drain requests and avoid old/new task overlap; multiple replicas need shared storage.
 */
export const layer = (appOrigin: URL, lifetimeMs = 10 * 60 * 1_000) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      type Entry = Owner & {
        readonly expiresAt: number
        readonly deferred: Deferred.Deferred<ProviderResponse>
      }
      const entries = SynchronizedRef.makeUnsafe(new Map<string, Entry>())
      const remove = (state: string, deferred: Deferred.Deferred<ProviderResponse>) =>
        SynchronizedRef.update(entries, (current) => {
          if (current.get(state)?.deferred !== deferred) return current
          const next = new Map(current)
          next.delete(state)
          return next
        })
      const register = Effect.fn("IntegrationOAuthCallback.register")((owner: Owner) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<ProviderResponse>()
          const registrationScope = yield* Scope.Scope
          const expiresAt = (yield* Clock.currentTimeMillis) + lifetimeMs
          const state = randomBytes(32).toString("base64url")
          const added = yield* SynchronizedRef.modify(entries, (current) =>
            current.has(state)
              ? [false, current]
              : [true, new Map(current).set(state, { ...owner, expiresAt, deferred })],
          )
          if (!added) return yield* Effect.die(new Error("OAuth callback state collision"))
          yield* Effect.addFinalizer(() => remove(state, deferred))
          yield* Effect.sleep(lifetimeMs).pipe(
            Effect.flatMap(() => remove(state, deferred)),
            Effect.forkIn(registrationScope, { startImmediately: true }),
          )
          return {
            state,
            callbackURI: new URL(callbackPath, appOrigin).href,
            expiresAt,
            wait: Deferred.await(deferred),
          }
        }),
      )
      const deliver = Effect.fn("IntegrationOAuthCallback.deliver")(function* (input: {
        readonly state?: string
        readonly code?: string
        readonly error?: string
        readonly errorDescription?: string
      }) {
        if (!input.state || input.state.length > 4096) return false
        const response =
          input.error &&
          input.error.length <= 4096 &&
          (input.errorDescription === undefined || input.errorDescription.length <= 4096)
            ? {
                error: input.error,
                ...(input.errorDescription === undefined ? {} : { errorDescription: input.errorDescription }),
              }
            : !input.error && input.code && input.code.length <= 4096
              ? { code: input.code }
              : undefined
        if (!response) return false
        const now = yield* Clock.currentTimeMillis
        const entry = yield* SynchronizedRef.modify(entries, (current) => {
          const found = current.get(input.state ?? "")
          if (!found) return [undefined, current]
          const next = new Map(current)
          next.delete(input.state ?? "")
          return [found, next]
        })
        if (!entry || entry.expiresAt <= now) return false
        return yield* Deferred.succeed(entry.deferred, response)
      })
      return Service.of({ register, deliver })
    }),
  )

/** Configured process-global OAuth callback coordinator for an application origin. */
export const configured = (appOrigin: URL) => makeGlobalNode({ service: Service, layer: layer(appOrigin), deps: [] })

/** Host-selected process-global OAuth callback coordinator. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)
