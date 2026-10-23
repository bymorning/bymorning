export * as PluginUpdate from "./plugin-update.js"

import { Clock, Context, Effect, Exit, Layer, PubSub, Schema, Semaphore, Stream } from "effect"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { mutable, production, type Registry } from "./plugin-update/registry.js"

const interval = 24 * 60 * 60 * 1_000

export interface Change {
  readonly target: string
  readonly outdated: boolean
  readonly updating: boolean
}

export interface Interface {
  readonly installed: (target: string) => Effect.Effect<{ readonly version: string; readonly revision: string } | undefined, CheckError>
  readonly check: (target: string) => Effect.Effect<boolean, CheckError>
  readonly update: (target: string) => Effect.Effect<void, UpdateError | DisabledError>
  readonly changes: () => Stream.Stream<Change>
}

export class CheckError extends Schema.TaggedError<CheckError>()("PluginUpdate.CheckError", {
  target: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
export class UpdateError extends Schema.TaggedError<UpdateError>()("PluginUpdate.UpdateError", {
  target: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
export class DisabledError extends Schema.TaggedError<DisabledError>()("PluginUpdate.DisabledError", {
  target: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginUpdate") {}

/** Update operations unavailable to isolated supervisor compositions. */
export const disabled = {
  installed: () => Effect.succeed(undefined),
  check: () => Effect.succeed(false),
  update: (target) => Effect.fail(new DisabledError({ target })),
  changes: () => Stream.never,
} as Interface

export const configured = (options: { readonly registry: Registry; readonly enabled: boolean }): Layer.Layer<Service> =>
  Layer.effect(Service, Effect.gen(function* () {
    if (!options.enabled) return Service.of(disabled)
    const locks = new Map<string, Semaphore.Semaphore>()
    const lock = (target: string) => {
      let value = locks.get(target)
      if (!value) { value = Semaphore.makeUnsafe(1); locks.set(target, value) }
      return value
    }
    const status = new Map<string, { readonly outdated: boolean; readonly checkedAt: number }>()
    const changes = yield* PubSub.unbounded<Change>()
    return Service.of({
      installed: (target) => options.registry.installed(target).pipe(
        Effect.mapError((error) => new CheckError({ target, cause: error })),
      ),
      check: (target) => lock(target).withPermit(Effect.gen(function* () {
        if (!mutable(target)) return false
        const checkedAt = yield* Clock.currentTimeMillis
        const current = status.get(target)
        if (current && checkedAt - current.checkedAt < interval) return current.outdated
        const installed = yield* options.registry.installed(target).pipe(
          Effect.mapError((error) => new CheckError({ target, cause: error })),
        )
        const latest = yield* options.registry.latest(target).pipe(
          Effect.mapError((error) => new CheckError({ target, cause: error })),
        )
        const outdated = installed !== undefined && latest !== undefined && installed.revision !== latest.revision
        status.set(target, { outdated, checkedAt })
        if ((current?.outdated ?? false) !== outdated) yield* PubSub.publish(changes, { target, outdated, updating: false })
        return outdated
      })),
      update: (target) => lock(target).withPermit(Effect.gen(function* () {
        const outdated = status.get(target)?.outdated ?? false
        yield* PubSub.publish(changes, { target, outdated, updating: true })
        return yield* options.registry.install(target).pipe(
          Effect.map(() => { status.set(target, { outdated: false, checkedAt: 0 }) }),
          Effect.mapError((error) => new UpdateError({ target, cause: error })),
          Effect.onExit((exit) => PubSub.publish(changes, { target, outdated: Exit.isSuccess(exit) ? false : outdated, updating: false })),
        )
      })),
      changes: () => Stream.fromPubSub(changes),
    })
  }))

export const layer = configured({ registry: production(), enabled: true })
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
