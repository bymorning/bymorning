import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Durable Workspace-owned policies and suppression state. */
export * as ManagedPolicy from "./managed-policy.js"

import type { Registration } from "./state.js"
import { Definition, ManagedSource, type Info } from "@bymorning/schema/policy"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Layer, Schema, Scope, Semaphore } from "effect"
import { Policy } from "./policy.js"
import { Storage } from "./storage.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "./actor.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ManagedPolicy.NotFoundError", {
  id: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ManagedPolicy.ConflictError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ManagedPolicy.ValidationError", {
  message: Schema.String,
}) {}

export interface Interface {
  /** Managed policies only. Plugin-contributed policies are listed by `Policy.Service`. */
  readonly list: Effect.Effect<ReadonlyArray<Info>>
  readonly create: (
    definition: Definition,
  ) => Effect.Effect<Info, ConflictError | ValidationError | Storage.OperationError | Storage.InputError | Actor.ForbiddenError>
  /** The path `id` wins; a body whose `id` differs is rejected. */
  readonly update: (
    id: string,
    definition: Definition,
  ) => Effect.Effect<Info, NotFoundError | ValidationError | Storage.OperationError | Storage.InputError | Actor.ForbiddenError>
  readonly delete: (id: string) => Effect.Effect<void, NotFoundError | Storage.OperationError | Actor.ForbiddenError>
  /** Managed policies rewrite `enabled`; plugin-contributed policies get a durable tombstone instead. */
  readonly setEnabled: (
    id: string,
    enabled: boolean,
  ) => Effect.Effect<Info, NotFoundError | Storage.OperationError | Storage.InputError | Actor.ForbiddenError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ManagedPolicy") {}

const strict = { errors: "all", onExcessProperty: "error" } as const

export const layer = (
  workspaceID: Workspace.ID,
): Layer.Layer<
  Service,
  Storage.OperationError | Storage.DecodeError | Storage.InputError,
  Policy.Service | Storage.Service
> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      const storageService = yield* Storage.Service
      const storage = storageService.scope({ workspaceID, pluginID: ManagedSource.pluginID })
      // Only Workspace administrators author permanent Permission rules. The
      // bound member's Role is the authority; caller-less constructions
      // (tests, internal system contexts) are trusted.
      const binding = yield* Effect.serviceOption(Actor.Binding.Service)
      const admin = Actor.Binding.requireAdmin(binding, "Only Workspace administrators can author policies")
      // Registrations outlive any request, so they are owned by the layer scope rather than a caller scope.
      const scope = yield* Scope.Scope
      const policies = new Map<string, Registration>()
      const tombstones = new Map<string, Registration>()
      // A persistence yield must not let another mutation invalidate its checks or registrations.
      const mutation = (yield* Semaphore.make(1)).withPermits(1)

      const decode = (input: unknown) =>
        Schema.decodeUnknownEffect(Definition)(input, strict).pipe(
          Effect.mapError((error) => new ValidationError({ message: String(error) })),
          Effect.flatMap((definition) => {
            const unenforced = definition.rules.find((rule) => !Policy.Enforced.has(rule.type))
            if (unenforced === undefined) return Effect.succeed(definition)
            return new ValidationError({
              message: `Policy ${definition.id}: rule kind "${unenforced.type}" is not enforced by this server yet`,
            })
          }),
        )
      const register = (definition: Definition) =>
        policy
          .transform((editor) =>
            editor.add({ ...definition, enabled: definition.enabled ?? true, source: ManagedSource }),
          )
          .pipe(Effect.provideService(Scope.Scope, scope))
      const suppress = (id: string) =>
        policy.transform((editor) => editor.remove(id)).pipe(Effect.provideService(Scope.Scope, scope))
      const current = (id: string) =>
        policy.list.pipe(
          Effect.flatMap((items) => {
            const found = items.find((item) => item.id === id)
            return found === undefined ? new NotFoundError({ id }) : Effect.succeed(found)
          }),
        )

      for (const entry of (yield* storage.scan({ prefix: "policy/" })).entries) {
        yield* decode(entry.value).pipe(
          Effect.flatMap((definition) =>
            register(definition).pipe(Effect.map((registration) => policies.set(definition.id, registration))),
          ),
          Effect.catch((error) =>
            Effect.logWarning("Failed to restore stored managed policy", { key: entry.key, error }),
          ),
        )
      }
      for (const entry of (yield* storage.scan({ prefix: "suppressed/" })).entries) {
        const id = entry.key.slice("suppressed/".length)
        yield* Schema.decodeUnknownEffect(Schema.Literal(true))(entry.value).pipe(
          Effect.flatMap(() => suppress(id)),
          Effect.map((registration) => tombstones.set(id, registration)),
          Effect.catch((error) =>
            Effect.logWarning("Failed to restore stored managed policy suppression", { key: entry.key, error }),
          ),
        )
      }

      return Service.of({
        list: policy.list.pipe(Effect.map((items) => items.filter((item) => item.managed))),
        create: Effect.fn("ManagedPolicy.create")(
          (input: Definition) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                yield* admin
                const definition = yield* decode(input)
                if ((yield* policy.list).some((item) => item.id === definition.id))
                  return yield* new ConflictError({
                    id: definition.id,
                    message: `Policy ID already exists: ${definition.id}`,
                  })
                yield* storage.set(`policy/${definition.id}`, definition)
                policies.set(definition.id, yield* register(definition))
                return yield* current(definition.id).pipe(Effect.orDie)
              }),
            ),
          mutation,
        ),
        update: Effect.fn("ManagedPolicy.update")(
          (id: string, input: Definition) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                yield* admin
                const previous = policies.get(id)
                if (previous === undefined) return yield* new NotFoundError({ id })
                const definition = yield* decode(input)
                if (definition.id !== id)
                  return yield* new ValidationError({ message: `Policy body ID must match path ID: ${id}` })
                yield* storage.set(`policy/${id}`, definition)
                yield* previous.dispose
                policies.set(id, yield* register(definition))
                return yield* current(id)
              }),
            ),
          mutation,
        ),
        delete: Effect.fn("ManagedPolicy.delete")(
          (id: string) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                yield* admin
                const registration = policies.get(id)
                if (registration === undefined) return yield* new NotFoundError({ id })
                yield* storage.remove(`policy/${id}`)
                yield* registration.dispose
                policies.delete(id)
              }),
            ),
          mutation,
        ),
        setEnabled: Effect.fn("ManagedPolicy.setEnabled")(
          (id: string, enabled: boolean) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                yield* admin
                const managed = policies.get(id)
                if (managed !== undefined) {
                  const info = yield* current(id)
                  const definition = {
                    id: info.id,
                    name: info.name,
                    ...(info.description === undefined ? {} : { description: info.description }),
                    enabled,
                    rules: info.rules,
                  }
                  yield* storage.set(`policy/${id}`, definition)
                  yield* managed.dispose
                  policies.set(id, yield* register(definition))
                  return yield* current(id)
                }
                const info = yield* current(id)
                const tombstone = tombstones.get(id)
                if (!enabled && tombstone === undefined) {
                  yield* storage.set(`suppressed/${id}`, true)
                  tombstones.set(id, yield* suppress(id))
                  return yield* current(id)
                }
                if (enabled && tombstone !== undefined) {
                  yield* storage.remove(`suppressed/${id}`)
                  yield* tombstone.dispose
                  tombstones.delete(id)
                  return yield* current(id)
                }
                return info
              }),
            ),
          mutation,
        ),
      })
    }),
  )

/** Canonical durable Managed Policy node for the verified member's Workspace. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Policy.node, Storage.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  policy: WorkspaceNode<Policy.Service, E>,
  storage?: GlobalNode<Storage.Service, E>,
) => makeWorkspaceNode({ service: Service, layer: layer(workspaceID), deps: [policy, storage ?? Storage.defaultNode] })
