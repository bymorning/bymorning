import { Catalog } from "@bymorning/core/catalog"
import { WorkspaceConfig } from "@bymorning/core/config"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Usage } from "@bymorning/core/usage"
import { Plugin } from "@bymorning/core/plugin"
import { Workspace } from "@bymorning/schema/workspace"
import { Duration, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import { LLMGatewayLease } from "./llm-gateway-lease.js"

const unused = (..._input: ReadonlyArray<unknown>) => Effect.die(new Error("unused"))

const capabilities = Layer.mergeAll(
  Plugin.Hooks.layer,
  Layer.mock(Catalog.Service, {
    provider: { get: unused, all: unused, available: unused, directory: unused, update: unused },
    model: {
      get: unused,
      all: unused,
      available: unused,
      visible: unused,
      requireAvailable: unused,
      requireExecution: unused,
      toggle: unused,
      setDefault: unused,
      default: unused,
      create: unused,
      update: unused,
      delete: unused,
    },
  }),
  Layer.mock(ModelResolver.Service, {}),
  Layer.mock(Usage.Service, {}),
  Layer.mock(WorkspaceConfig.Service, {
    provider: { update: unused },
    modelPolicy: { reconcile: unused, toggle: unused, setDefault: unused },
    model: { put: unused, remove: unused },
    mcp: { update: () => Effect.die(new Error("unused")), put: unused, remove: unused },
    plugin: WorkspaceConfig.pluginUnavailable,
  }),
) as Layer.Layer<LLMGateway.Capabilities>

describe("LLMGatewayLease", () => {
  it("retains one graph per Workspace until invalidation, while live scopes keep the old graph", async () => {
    const builds: Array<Workspace.ID> = []
    const releases: Array<Workspace.ID> = []
    const recipe = ((workspaceID: Workspace.ID) =>
      Layer.mergeAll(
        Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.sync(() => void builds.push(workspaceID)),
            () => Effect.sync(() => void releases.push(workspaceID)),
          ),
        ),
        capabilities,
      )) as LLMGatewayLease.Recipe
    const first = Workspace.ID.create()
    const second = Workspace.ID.create()
    const layer = LLMGatewayLease.layerFromFactory({ acquire: recipe, idleTimeToLive: Duration.minutes(1) })

    await Effect.runPromise(
      Effect.gen(function* () {
        const lease = yield* LLMGateway.Lease.Service
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* lease.acquire(first)
            yield* lease.acquire(first)
            yield* lease.acquire(second)
            expect(builds).toEqual([first, second])

            yield* lease.invalidate(first)
            yield* lease.acquire(first)
            expect(builds).toEqual([first, second, first])

            expect(releases).toEqual([])
          }),
        )
        expect(releases).toEqual([])
        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
        expect(releases.filter((workspaceID) => workspaceID === first)).toHaveLength(2)
        expect(releases.filter((workspaceID) => workspaceID === second)).toHaveLength(1)
      }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(TestClock.layer())))),
    )
  })

  it("keeps an idle graph through its TTL and rebuilds it after the TTL expires", async () => {
    const builds: Array<Workspace.ID> = []
    const workspaceID = Workspace.ID.create()
    const layer = LLMGatewayLease.layerFromFactory({
      acquire: (id) => Layer.mergeAll(Layer.effectDiscard(Effect.sync(() => void builds.push(id))), capabilities),
      idleTimeToLive: Duration.minutes(1),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const lease = yield* LLMGateway.Lease.Service
        const acquire = () => Effect.scoped(lease.acquire(workspaceID))
        yield* acquire()
        yield* TestClock.adjust(Duration.seconds(59))
        yield* Effect.yieldNow
        yield* acquire()
        expect(builds).toEqual([workspaceID])

        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
        yield* acquire()
        expect(builds).toEqual([workspaceID, workspaceID])
      }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(TestClock.layer())))),
    )
  })
})
