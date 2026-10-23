import { describe, expect, it } from "@effect/vitest"
import { Plugin } from "@bymorning/schema/plugin"
import * as PolicySchema from "@bymorning/schema/policy"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope } from "effect"
import { ManagedPolicy } from "../src/managed-policy.js"
import { Policy } from "../src/policy.js"
import { Storage } from "../src/storage.js"

const workspaceID = Workspace.ID.make("wrk_managed_policy_test")
const source = PolicySchema.Source.make({
  type: "plugin",
  pluginID: Plugin.ID.make("test.plugin"),
  pluginSource: { type: "sdk" },
})

describe("ManagedPolicy", () => {
  it.effect("serializes overlapping creates before checking uniqueness and writing durable state", () =>
    Effect.gen(function* () {
      const fixture = yield* gated()
      yield* Ref.set(fixture.armed, true)
      const first = yield* fixture.managed
        .create(definition("race", "First"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(fixture.entered)
      const finished = yield* Deferred.make<void>()
      const second = yield* fixture.managed.create(definition("race", "Second")).pipe(
        Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "success" }),
        Effect.tap(() => Deferred.succeed(finished, undefined)),
        Effect.forkChild({ startImmediately: true }),
      )
      const overtook = yield* Deferred.isDone(finished)
      yield* Deferred.succeed(fixture.release, undefined)
      expect((yield* Fiber.join(first)).name).toBe("First")
      expect(yield* Fiber.join(second)).toBe("ManagedPolicy.ConflictError")
      expect(overtook).toBe(false)
      expect((yield* fixture.managed.list).map((item) => item.name)).toEqual(["First"])
      expect(yield* fixture.kv.get("policy/race")).toEqual(definition("race", "First"))
    }).pipe(Effect.provide(base)),
  )

  const conflicts = [
    { first: "update", second: "delete", expected: undefined, result: "success" },
    { first: "delete", second: "update", expected: undefined, result: "ManagedPolicy.NotFoundError" },
    { first: "update", second: "enable", expected: { name: "Updated", enabled: false }, result: "success" },
    { first: "enable", second: "update", expected: { name: "Updated", enabled: true }, result: "success" },
    { first: "delete", second: "enable", expected: undefined, result: "ManagedPolicy.NotFoundError" },
    { first: "enable", second: "delete", expected: undefined, result: "success" },
  ] as const

  for (const variant of conflicts) {
    it.effect(`serializes ${variant.first} before conflicting ${variant.second}`, () =>
      Effect.gen(function* () {
        const fixture = yield* gated()
        yield* fixture.managed.create(definition("race", "Original"))
        const mutate = (operation: "update" | "delete" | "enable") => {
          switch (operation) {
            case "update":
              return fixture.managed
                .update("race", { ...definition("race", "Updated"), enabled: true })
                .pipe(Effect.asVoid)
            case "delete":
              return fixture.managed.delete("race")
            case "enable":
              return fixture.managed.setEnabled("race", false).pipe(Effect.asVoid)
          }
        }
        yield* Ref.set(fixture.armed, true)
        const first = yield* mutate(variant.first).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(fixture.entered)
        const finished = yield* Deferred.make<void>()
        const second = yield* mutate(variant.second).pipe(
          Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "success" }),
          Effect.tap(() => Deferred.succeed(finished, undefined)),
          Effect.forkChild({ startImmediately: true }),
        )
        const overtook = yield* Deferred.isDone(finished)
        yield* Deferred.succeed(fixture.release, undefined)
        yield* Fiber.join(first)
        expect(yield* Fiber.join(second)).toBe(variant.result)
        expect(overtook).toBe(false)
        const active = yield* fixture.managed.list
        const stored = yield* fixture.kv.get("policy/race")
        if (variant.expected === undefined) {
          expect(active).toEqual([])
          expect(stored).toBeUndefined()
        } else {
          expect(active).toHaveLength(1)
          expect(active[0]).toMatchObject(variant.expected)
          expect(stored).toEqual({ ...definition("race", variant.expected.name), enabled: variant.expected.enabled })
        }
      }).pipe(Effect.provide(base)),
    )
  }

  it.effect("fails restoration through the typed storage error channel", () =>
    Effect.gen(function* () {
      const memory = Storage.memory()
      const failure = new Storage.OperationError({
        message: "Listing unavailable",
        providerID: memory.id,
        operation: "list",
        cause: undefined,
      })
      const storage = Storage.layer({
        configure: (editor) => {
          editor.add({
            ...memory,
            open: memory.open.pipe(Effect.map((driver) => ({ ...driver, list: () => Effect.fail(failure) }))),
          })
          editor.default.set(memory.id)
        },
      })
      const result = yield* Layer.buildWithScope(
        ManagedPolicy.layer(workspaceID).pipe(Layer.provide(Layer.merge(Policy.layer, storage))),
        yield* Scope.Scope,
      ).pipe(Effect.flip)
      expect(result).toBe(failure)
    }),
  )

  it.effect("retains active policies when persistence fails and returns the typed failure", () =>
    Effect.gen(function* () {
      const failed = yield* Ref.make(false)
      const memory = Storage.memory()
      const provider: Storage.Provider = {
        ...memory,
        open: memory.open.pipe(
          Effect.map((driver) => ({
            ...driver,
            set: (path, input) =>
              Ref.get(failed).pipe(
                Effect.flatMap((fail) =>
                  fail
                    ? Effect.fail(
                        new Storage.OperationError({
                          message: "Write unavailable",
                          providerID: memory.id,
                          operation: "set",
                          cause: undefined,
                        }),
                      )
                    : driver.set(path, input),
                ),
              ),
            remove: (path) =>
              Ref.get(failed).pipe(
                Effect.flatMap((fail) =>
                  fail
                    ? Effect.fail(
                        new Storage.OperationError({
                          message: "Write unavailable",
                          providerID: memory.id,
                          operation: "remove",
                          cause: undefined,
                        }),
                      )
                    : driver.remove(path),
                ),
              ),
          })),
        ),
      }
      const scope = yield* Scope.Scope
      const context = yield* Layer.buildWithScope(
        Storage.layer({
          configure: (editor) => {
            editor.add(provider)
            editor.default.set(provider.id)
          },
        }),
        scope,
      )
      const storage = Context.get(context, Storage.Service)
      const policy = yield* Policy.Service
      const managed = yield* build(scope, policy, storage)
      yield* managed.create(definition("existing", "Original"))
      yield* policy.transform((editor) => editor.add({ ...definition("plugin", "Plugin"), enabled: true, source }))
      yield* Ref.set(failed, true)

      expect((yield* managed.create(definition("new", "New")).pipe(Effect.flip))._tag).toBe("Storage.OperationError")
      expect((yield* managed.update("existing", definition("existing", "Changed")).pipe(Effect.flip))._tag).toBe(
        "Storage.OperationError",
      )
      expect((yield* managed.delete("existing").pipe(Effect.flip))._tag).toBe("Storage.OperationError")
      expect((yield* managed.setEnabled("existing", false).pipe(Effect.flip))._tag).toBe("Storage.OperationError")
      expect((yield* managed.setEnabled("plugin", false).pipe(Effect.flip))._tag).toBe("Storage.OperationError")
      expect((yield* managed.list).map(({ id, name, enabled }) => ({ id, name, enabled }))).toEqual([
        { id: "existing", name: "Original", enabled: true },
      ])
      expect((yield* policy.list).find((item) => item.id === "plugin")?.suppressed).toBe(false)
      expect(
        yield* storage.scope({ workspaceID, pluginID: PolicySchema.ManagedSource.pluginID }).get("policy/existing"),
      ).toEqual(definition("existing", "Original"))
    }).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("creates, updates, and deletes managed policies durably", () =>
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      const storage = yield* Storage.Service
      const firstScope = yield* Scope.make()
      const first = yield* build(firstScope, policy, storage)
      expect((yield* first.create(definition("managed", "First"))).managed).toBe(true)
      expect((yield* first.update("managed", definition("managed", "Updated"))).name).toBe("Updated")
      yield* Scope.close(firstScope, Exit.void)

      const secondScope = yield* Scope.make()
      const second = yield* build(secondScope, policy, storage)
      expect((yield* second.list).map((item) => item.name)).toEqual(["Updated"])
      yield* second.delete("managed")
      expect(yield* second.list).toEqual([])
      yield* Scope.close(secondScope, Exit.void)
    }).pipe(Effect.provide(base)),
  )

  it.effect("rejects conflicts with plugin-contributed IDs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policy = yield* Policy.Service
        const managed = yield* ManagedPolicy.Service
        yield* policy.transform((editor) => editor.add({ ...definition("taken", "Taken"), enabled: true, source }))
        expect((yield* managed.create(definition("taken", "Managed")).pipe(Effect.flip))._tag).toBe(
          "ManagedPolicy.ConflictError",
        )
        expect((yield* managed.update("taken", definition("taken", "Managed")).pipe(Effect.flip))._tag).toBe(
          "ManagedPolicy.NotFoundError",
        )
        expect((yield* managed.delete("taken").pipe(Effect.flip))._tag).toBe("ManagedPolicy.NotFoundError")
        expect(yield* managed.list).toEqual([])
      }),
    ).pipe(Effect.provide(full)),
  )

  it.effect("suppresses and restores a plugin-contributed policy via setEnabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policy = yield* Policy.Service
        const managed = yield* ManagedPolicy.Service
        yield* policy.transform((editor) =>
          editor.add({
            ...definition("plugin", "Plugin"),
            enabled: true,
            source,
          }),
        )
        expect((yield* managed.setEnabled("plugin", false)).suppressed).toBe(true)
        expect(yield* policy.select("guardrail")).toEqual([])
        expect((yield* managed.setEnabled("plugin", true)).suppressed).toBe(false)
        expect(yield* policy.select("guardrail")).toHaveLength(1)
        expect((yield* managed.setEnabled("missing", false).pipe(Effect.flip))._tag).toBe("ManagedPolicy.NotFoundError")
      }),
    ).pipe(Effect.provide(full)),
  )

  it.effect("rejects invalid definitions and unenforced kinds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const managed = yield* ManagedPolicy.Service
        const invalid = yield* managed
          .create({
            id: "invalid",
            name: "Invalid",
            rules: [{ type: "prompt", match: { pattern: "[" }, replacement: "" }],
          })
          .pipe(Effect.flip)
        expect(invalid._tag).toBe("ManagedPolicy.ValidationError")
        const unwired = [
          {
            id: "unwired-input",
            name: "Unwired input",
            rules: [{ type: "tool.input", tool: "*", match: { pattern: "x" } }],
          },
          {
            id: "unwired-output",
            name: "Unwired output",
            rules: [{ type: "tool.output", tool: "*", match: { pattern: "x" }, replacement: "" }],
          },
          {
            id: "unwired-escalate",
            name: "Unwired escalate",
            rules: [{ type: "escalate", tool: "*", target: "openai/model" }],
          },
        ] as const
        for (const candidate of unwired) {
          const rejected = yield* managed.create(candidate).pipe(Effect.flip)
          expect(rejected._tag).toBe("ManagedPolicy.ValidationError")
          expect(rejected.message).toContain("not enforced")
        }
      }),
    ).pipe(Effect.provide(full)),
  )
})

const base = Layer.merge(
  Policy.layer,
  Storage.layer({
    configure: (editor) => {
      const provider = Storage.memory()
      editor.add(provider)
      editor.default.set(provider.id)
    },
  }),
)
const full = Layer.merge(base, ManagedPolicy.layer(workspaceID).pipe(Layer.provide(base)))

const build = (scope: Scope.Scope, policy: Policy.Interface, storage: Storage.Interface) =>
  Layer.buildWithScope(
    ManagedPolicy.layer(workspaceID).pipe(
      Layer.provide(Layer.merge(Layer.succeed(Policy.Service, policy), Layer.succeed(Storage.Service, storage))),
    ),
    scope,
  ).pipe(Effect.map((context) => Context.get(context, ManagedPolicy.Service)))

// Pause an armed mutation at the public KV seam, retaining real JSON/persistence and Policy behavior.
const gated = Effect.fn("Test.gated")(function* () {
  const storage = yield* Storage.Service
  const policy = yield* Policy.Service
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const armed = yield* Ref.make(false)
  const pause = Effect.gen(function* () {
    if (!(yield* Ref.getAndSet(armed, false))) return
    yield* Deferred.succeed(entered, undefined)
    yield* Deferred.await(release)
  })
  const selected: Storage.Interface = {
    ...storage,
    scope: (namespace) => {
      const kv = storage.scope(namespace)
      return {
        ...kv,
        set: (key, value) => pause.pipe(Effect.andThen(kv.set(key, value))),
        remove: (key) => pause.pipe(Effect.andThen(kv.remove(key))),
      }
    },
  }
  const managed = yield* build(yield* Scope.Scope, policy, selected)
  return {
    managed,
    armed,
    entered,
    release,
    kv: storage.scope({ workspaceID, pluginID: PolicySchema.ManagedSource.pluginID }),
  }
})

const definition = (id: string, name: string): PolicySchema.Definition => ({
  id,
  name,
  rules: [{ type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny" }],
})
