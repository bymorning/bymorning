import { Workspace } from "@bymorning/schema/workspace"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Plugin } from "@bymorning/core/plugin"
import { Job } from "@bymorning/core/job"
import { Tool } from "@bymorning/core/tool"
import { PluginHooks } from "@bymorning/core/plugin/hooks"
import { Context, Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { expect, test } from "vitest"
import { makeGlobalNode, makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { WorkspaceMap } from "./workspace-map.js"
import { workspaceMap } from "../test/workspace-map.js"

class TestService extends Context.Service<TestService, { readonly workspaceID: Workspace.ID }>()(
  "@bymorning/server/test/WorkspaceMap",
) {}

class TestBus extends Context.Service<TestBus, { readonly identity: object }>()(
  "@bymorning/server/test/WorkspaceMapBus",
) {}

class TestReady extends Context.Service<TestReady, {}>()("@bymorning/server/test/WorkspaceMapReady") {}

class TestIdentity extends Context.Service<TestIdentity, { readonly bus: object; readonly plugin: Plugin.Interface }>()(
  "@bymorning/server/test/WorkspaceMapIdentity",
) {}

const owner = (workspaceID: Workspace.ID, account = "acc_workspace_map") => ({
  workspaceID,
  accountID: Account.ID.make(account),
  userID: User.ID.make(`usr_${account.slice(4)}`),
  role: "admin" as const,
})

test("acquires process services before readiness and injects the same identities into two Workspace graphs", async () => {
  let busAcquisitions = 0
  let busReleases = 0
  let registrations = 0
  const workspaceReleases = Array<Workspace.ID>()
  const identity = {}
  const bus = Layer.effect(
    TestBus,
    Effect.acquireRelease(
      Effect.sync(() => {
        busAcquisitions++
        return TestBus.of({ identity })
      }),
      () => Effect.sync(() => busReleases++),
    ),
  )
  const project = Layer.effect(
    TestReady,
    Effect.gen(function* () {
      yield* TestBus
      registrations++
      return TestReady.of({})
    }),
  ).pipe(Layer.provide(bus))
  const runtime = Layer.merge(bus, project)
  const mapped = WorkspaceMap.layerFromFactory<TestBus | TestReady>({
    services: (owner) =>
      // This focused fixture exposes only the identity capability exercised here.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- production Capabilities intentionally exclude process services
      Layer.effect(
        TestIdentity,
        Effect.acquireRelease(
          Effect.map(TestBus, (stable) =>
            TestIdentity.of({
              bus: stable.identity,
              plugin: Plugin.Service.of({
                awaitActivation: Effect.void,
                hold: () => Effect.succeed(Effect.void),
                close: () => Effect.void,
                activate: () => Effect.void,
                list: () => Effect.succeed([]),
              }),
            }),
          ),
          () => Effect.sync(() => workspaceReleases.push(owner.workspaceID)),
        ),
      ).pipe(Layer.fresh) as unknown as Layer.Layer<WorkspaceMap.Capabilities, never, TestBus>,
  }).pipe(Layer.provide(runtime))

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceMap = yield* WorkspaceMap.Service
      const get = (workspaceID: Workspace.ID) =>
        Effect.scoped(workspaceMap.contextEffect(owner(workspaceID))).pipe(
          Effect.map((context) => {
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused capability fixture is hidden behind the production map type
            return Context.get(context as unknown as Context.Context<TestIdentity>, TestIdentity)
          }),
        )
      const firstIdentity = yield* get(Workspace.ID.make("wrk_bus_first"))
      const secondIdentity = yield* get(Workspace.ID.make("wrk_bus_second"))
      expect(firstIdentity.bus).toBe(identity)
      expect(secondIdentity.bus).toBe(identity)
      expect(firstIdentity.plugin).not.toBe(secondIdentity.plugin)

      yield* workspaceMap.invalidate(owner(Workspace.ID.make("wrk_bus_first")))
      expect(workspaceReleases).toEqual(["wrk_bus_first"])
      expect(busReleases).toBe(0)

      const reacquiredIdentity = yield* get(Workspace.ID.make("wrk_bus_first"))
      expect(reacquiredIdentity.bus).toBe(identity)
      expect(reacquiredIdentity.plugin).not.toBe(firstIdentity.plugin)
    }).pipe(Effect.scoped, Effect.provide(mapped)),
  )

  expect(busAcquisitions).toBe(1)
  expect(registrations).toBe(1)
  expect(workspaceReleases.sort()).toEqual(["wrk_bus_first", "wrk_bus_first", "wrk_bus_second"])
  expect(busReleases).toBe(1)
})

test("reuses isolated Workspace graphs after request scopes close and releases them with the process scope", async () => {
  const acquired = Array<Workspace.ID>()
  const released = Array<Workspace.ID>()
  const services = (workspaceID: Workspace.ID) =>
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- omitted capabilities are not exercised
    Layer.effect(
      TestService,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquired.push(workspaceID)
          return TestService.of({ workspaceID })
        }),
        () => Effect.sync(() => released.push(workspaceID)),
      ),
    ) as unknown as Layer.Layer<WorkspaceMap.Capabilities>

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceMap = yield* WorkspaceMap.Service
      const firstID = Workspace.ID.make("wrk_function_first")
      const secondID = Workspace.ID.make("wrk_function_second")
      const get = (workspaceID: Workspace.ID) =>
        Effect.scoped(workspaceMap.contextEffect(owner(workspaceID))).pipe(
          Effect.map((context) => {
            // This lifecycle fixture installs a focused test capability behind the production capability-map type.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the fixture deliberately hides TestService behind WorkspaceMap.Capabilities
            const testContext = context as unknown as Context.Context<TestService>
            return Context.get(testContext, TestService).workspaceID
          }),
        )
      const values = yield* Effect.all([get(firstID), get(firstID), get(secondID)])
      expect(released).toEqual([])
      return values
    }).pipe(Effect.scoped, Effect.provide(workspaceMap(services))),
  )

  expect(result).toEqual(["wrk_function_first", "wrk_function_first", "wrk_function_second"])
  expect(acquired).toEqual(["wrk_function_first", "wrk_function_second"])
  expect(released).toEqual(["wrk_function_first", "wrk_function_second"])
})

test("retains exactly one isolated Job registry in each Workspace graph", async () => {
  const mapped = WorkspaceMap.layerFromFactory({
    services: () => Job.layer.pipe(Layer.fresh) as Layer.Layer<WorkspaceMap.Capabilities>,
  })

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceMap.Service
      const firstID = Workspace.ID.make("wrk_job_first")
      const secondID = Workspace.ID.make("wrk_job_second")
      const first = Context.get(yield* workspaces.contextEffect(owner(firstID)), Job.Service)
      const retained = Context.get(yield* workspaces.contextEffect(owner(firstID)), Job.Service)
      const second = Context.get(yield* workspaces.contextEffect(owner(secondID)), Job.Service)

      expect(first).toBe(retained)
      expect(first).not.toBe(second)
    }).pipe(Effect.scoped, Effect.provide(mapped)),
  )
})

test("two live runtimes isolate the same Workspace key and shared mutable Layer identity", async ({ signal }) => {
  const mapped = WorkspaceMap.layerFromFactory({
    // Reusing this exact Layer is intentional: process ownership must isolate it
    // without relying on each test caller to wrap the business service in fresh.
    services: () => Job.layer as Layer.Layer<WorkspaceMap.Capabilities>,
  }).pipe(Layer.provideMerge(Job.layer))
  const first = ManagedRuntime.make(mapped)
  const second = ManagedRuntime.make(mapped)
  const selected = owner(Workspace.ID.make("wrk_independent_runtime"))
  const job = Effect.gen(function* () {
    const workspaces = yield* WorkspaceMap.Service
    return Context.get(yield* workspaces.contextEffect(selected), Job.Service)
  }).pipe(Effect.scoped)
  try {
    const firstJob = await first.runPromise(job, { signal })
    const secondJob = await second.runPromise(job, { signal })
    expect(firstJob).not.toBe(secondJob)
    expect(firstJob).toBe(await first.runPromise(Job.Service, { signal }))
    expect(secondJob).toBe(await second.runPromise(Job.Service, { signal }))
    expect(await first.runPromise(job, { signal })).toBe(firstJob)
    expect(await second.runPromise(job, { signal })).toBe(secondJob)

    const firstReleased = await Effect.runPromise(Deferred.make<void>())
    const finishSecond = await Effect.runPromise(Deferred.make<string>())
    await first.runPromise(
      firstJob.start({
        id: "same-job",
        type: "runtime-isolation",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(firstReleased, undefined))),
      }),
      { signal },
    )
    expect(await second.runPromise(secondJob.get("same-job"), { signal })).toBeUndefined()
    await second.runPromise(
      secondJob.start({ id: "same-job", type: "runtime-isolation", run: Deferred.await(finishSecond) }),
      { signal },
    )

    await first.dispose()
    await Effect.runPromise(Deferred.await(firstReleased), { signal })
    expect(await second.runPromise(secondJob.get("same-job"), { signal })).toMatchObject({ status: "running" })
    await Effect.runPromise(Deferred.succeed(finishSecond, "second runtime result"))
    expect(await second.runPromise(secondJob.wait({ id: "same-job" }), { signal })).toMatchObject({
      info: { status: "completed", output: "second runtime result" },
      timedOut: false,
    })
  } finally {
    await first.dispose()
    await second.dispose()
  }
})

test("uses structural account and Workspace keys while isolating either dimension", async () => {
  const acquisitions: WorkspaceMap.Owner[] = []
  const mapped = WorkspaceMap.layerFromFactory({
    services: (runtimeOwner) => {
      acquisitions.push(runtimeOwner)
      return Job.layer.pipe(Layer.fresh) as Layer.Layer<WorkspaceMap.Capabilities>
    },
  })
  const workspaceID = Workspace.ID.make("wrk_structural_runtime")
  const first = owner(workspaceID, "acc_structural_first")
  const same = { ...first }
  const siblingAccount = owner(workspaceID, "acc_structural_second")
  const siblingWorkspace = owner(Workspace.ID.make("wrk_structural_sibling"), "acc_structural_first")

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceMap.Service
      const firstJob = Context.get(yield* workspaces.contextEffect(first), Job.Service)
      expect(Context.get(yield* workspaces.contextEffect(same), Job.Service)).toBe(firstJob)
      expect(Context.get(yield* workspaces.contextEffect(siblingAccount), Job.Service)).not.toBe(firstJob)
      expect(Context.get(yield* workspaces.contextEffect(siblingWorkspace), Job.Service)).not.toBe(firstJob)
    }).pipe(Effect.scoped, Effect.provide(mapped)),
  )

  expect(acquisitions).toEqual([first, siblingAccount, siblingWorkspace])
})

test("uses declaration identity rather than service names for global implementations", async () => {
  const stableJob = makeGlobalNode({ service: Job.Service, layer: Job.layer, deps: [] })
  const recreatedJob = makeGlobalNode({ service: Job.Service, layer: Job.layer.pipe(Layer.fresh), deps: [] })
  const mapped = WorkspaceMap.node({
    bindings: [],
    member: () =>
      // This negative fixture must claim the production capability surface to reach the runtime conflict check.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      makeWorkspaceNode({
        service: Job.Service,
        layer: Layer.effect(
          Job.Service,
          Effect.map(Job.Service, (job) => job),
        ),
        deps: [stableJob, recreatedJob],
      }) as WorkspaceNode<WorkspaceMap.Capabilities>,
  })

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceMap.Service
      yield* workspaces.contextEffect(owner(Workspace.ID.make("wrk_conflicting_global")))
    }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(mapped))),
  )
})

test("production keyed compilation isolates static Tool Layers while retaining one registry and shared globals", async ({
  signal,
}) => {
  class Capture extends Context.Service<Capture, { readonly tool: Tool.Interface; readonly bus: object }>()(
    "test/ToolCapture",
  ) {}
  let acquisitions = 0
  const bus = makeGlobalNode({
    service: TestBus,
    layer: Layer.sync(TestBus, () => {
      acquisitions++
      return { identity: {} }
    }),
    deps: [],
  })
  const mapped = WorkspaceMap.node({
    bindings: [],
    member: (member) => {
      const hooks = PluginHooks.node
      // Deliberately reuse the exported static Layer, as production Tool nodes do.
      const tool = makeWorkspaceNode({ service: Tool.Service, layer: Tool.layer, deps: [hooks] })
      const capture = makeWorkspaceNode({
        service: Capture,
        layer: Layer.effect(
          Capture,
          Effect.gen(function* () {
            const tool = yield* Tool.Service
            const shared = yield* TestBus
            yield* Tool.withSource(
              tool.transform((draft) =>
                draft.add({
                  name: "member",
                  description: "Captured member",
                  input: Schema.Struct({}),
                  output: Schema.String,
                  options: { codemode: false },
                  execute: () => Effect.succeed({ output: member.accountID }),
                }),
              ),
              { type: "sdk" },
              member.workspaceID,
            )
            return { tool, bus: shared.identity }
          }),
        ),
        deps: [tool, bus],
      })
      // Focused graph exercises the production compiler without unrelated services.
      return LayerNode.group([tool, capture]) as WorkspaceNode<WorkspaceMap.Capabilities>
    },
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceMap.Service
      const workspaceID = Workspace.ID.make("wrk_static_tool")
      const firstOwner = owner(workspaceID, "acc_static_first")
      const secondOwner = owner(workspaceID, "acc_static_second")
      const first = yield* workspaces.contextEffect(firstOwner)
      const firstTool = Context.get(first, Tool.Service)
      const before = yield* firstTool.snapshot([], "gateway")
      const second = yield* workspaces.contextEffect(secondOwner)
      const secondTool = Context.get(second, Tool.Service)
      const firstCapture = Context.get(first as unknown as Context.Context<Capture>, Capture)
      const secondCapture = Context.get(second as unknown as Context.Context<Capture>, Capture)
      expect(firstTool).not.toBe(secondTool)
      expect(firstCapture.tool).toBe(firstTool)
      expect(secondCapture.tool).toBe(secondTool)
      expect(firstCapture.bus).toBe(secondCapture.bus)
      expect(acquisitions).toBe(1)
      expect(Context.get(yield* workspaces.contextEffect(firstOwner), Tool.Service)).toBe(firstTool)
      const invoke = (snapshot: Tool.Snapshot, member: WorkspaceMap.Owner) =>
        snapshot.execute({
          call: { type: "tool-call", id: "call_member", name: "member", input: {} },
          context: {
            caller: { type: "gateway", userID: member.userID },
            id: Tool.CallID.make("call_member"),
            progress: () => Effect.void,
            permission: () => Effect.void,
            elicit: () => Effect.die(new Error("unused")),
          },
        })
      expect(before.definitions.map((definition) => definition.name)).toContain("member")
      expect((yield* invoke(before, firstOwner)).output).toBe(firstOwner.accountID)
      const firstSnapshot = yield* firstTool.snapshot([], "gateway")
      expect((yield* invoke(firstSnapshot, firstOwner)).output).toBe(firstOwner.accountID)
      expect((yield* invoke(yield* secondTool.snapshot([], "gateway"), secondOwner)).output).toBe(secondOwner.accountID)
      yield* workspaces.invalidate(secondOwner)
      expect((yield* invoke(firstSnapshot, firstOwner)).output).toBe(firstOwner.accountID)
    }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(mapped))),
    { signal },
  )
})
