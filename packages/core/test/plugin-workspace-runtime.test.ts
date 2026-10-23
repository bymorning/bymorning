import { describe, expect, it } from "@effect/vitest"
import { Config } from "../src/config.js"
import { Status } from "../src/plugin/registry-service.js"
import { ActivationError, Service as Supervisor } from "../src/plugin/supervisor-service.js"
import { reload } from "../src/plugin/workspace-runtime.js"
import { Context, Deferred, Effect, Ref } from "effect"

const unused = () => Effect.die("unused")

const configOf = (refresh: Config.Interface["refresh"]): Config.Interface =>
  Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: unused(),
    update: unused,
    refresh,
    modelPolicy: {
      reconcile: unused,
      toggle: unused,
      setDefault: unused,
    },
    mcp: { update: () => Effect.die("unused"), put: unused, remove: unused },
    plugin: { configure: unused },
    entries: unused,
    changes: () => null as never,
  })

describe("Plugin Workspace reload", () => {
  it.effect("returns a ticket immediately while drain proceeds to Active", () =>
    Effect.gen(function* () {
      const refreshed = yield* Ref.make(0)
      const reloaded = yield* Ref.make(0)
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const runtime = Context.empty().pipe(
        Context.add(
          Config.Service,
          configOf(Ref.update(refreshed, (count) => count + 1).pipe(Effect.as({} as never))),
        ),
        Context.add(
          Supervisor,
          Supervisor.of({
            awaitActivation: Effect.void,
            reload: Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(gate)
              yield* Ref.update(reloaded, (count) => count + 1)
            }),
            reloadAfter: unused,
          }),
        ),
      )
      const ticket = yield* reload(runtime)
      expect(["Pending", "Draining"]).toContain((yield* ticket.status)._tag)
      yield* Deferred.await(entered)
      expect(yield* ticket.status).toEqual(Status.Draining({ hook: "model.invoke" }))
      expect(yield* Ref.get(reloaded)).toBe(0)
      yield* Deferred.succeed(gate, undefined)
      expect(yield* ticket.await).toEqual(Status.Active())
      expect(yield* Ref.get(refreshed)).toBe(1)
      expect(yield* Ref.get(reloaded)).toBe(1)
    }),
  )

  it.effect("surfaces background failure as a Failed ticket without copying cause text", () =>
    Effect.gen(function* () {
      const runtime = Context.empty().pipe(
        Context.add(Config.Service, configOf(Effect.succeed({} as never))),
        Context.add(
          Supervisor,
          Supervisor.of({
            awaitActivation: Effect.void,
            reload: Effect.fail(new ActivationError({ cause: new Error("credential=super-secret") })),
            reloadAfter: unused,
          }),
        ),
      )
      const ticket = yield* reload(runtime)
      const failed = yield* ticket.await
      expect(failed._tag).toBe("Failed")
      if (failed._tag !== "Failed") return
      expect(failed.error).toBe("Plugin reload failed")
      expect(failed.hook).toBe("model.invoke")
      expect(failed.ref).toMatch(/^err_[0-9a-f]{8}$/)
      expect(JSON.stringify(failed)).not.toContain("super-secret")
      expect(JSON.stringify(failed)).not.toContain("credential")
    }),
  )
})
