import { Plugin } from "@bymorning/core/plugin"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { Account } from "@bymorning/schema/account"
import { UserActor } from "@bymorning/schema/actor"
import { PluginSchema } from "@bymorning/schema/plugin"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Cause, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { ToolGatewayRuntime } from "./tool-gateway-runtime.js"
import { WorkspaceMap } from "./workspace-map.js"

const actor = new UserActor({
  type: "user",
  properties: {
    workspaceID: Workspace.ID.make("wrk_tool_gateway_runtime"),
    accountID: Account.ID.make("acc_tool_gateway_runtime"),
    userID: User.ID.make("usr_tool_gateway_runtime"),
    role: "member",
  },
})

const member = ToolGateway.Member.Service.of({
  snapshot: Effect.die(new Error("unused")),
  call: () => Effect.die(new Error("unused")),
  resume: () => Effect.die(new Error("unused")),
})

const plugin = (activation: Plugin.Interface["awaitActivation"]) =>
  Plugin.Service.of({
    awaitActivation: activation,
    hold: () => Effect.succeed(Effect.void),
    close: () => Effect.void,
    activate: () => Effect.void,
    list: () => Effect.succeed([]),
  })

const capabilities = (activation: Plugin.Interface["awaitActivation"], released: string[]) =>
  Layer.mergeAll(
    Layer.effectDiscard(
      Effect.acquireRelease(Effect.void, () => Effect.sync(() => released.push(actor.properties.workspaceID))),
    ),
    Layer.succeed(Plugin.Service, plugin(activation)),
    Layer.succeed(ToolGateway.Member.Service, member),
  ) as Layer.Layer<WorkspaceMap.Capabilities>

describe("ToolGatewayRuntime", () => {
  it("maps Plugin activation failure to the package-owned availability error", async () => {
    const failure = new Plugin.ActivationError({
      pluginID: PluginSchema.ID.make("required.tool"),
      message: "sensitive activation detail",
    })
    const workspaces = WorkspaceMap.layerFromFactory({ services: () => capabilities(Effect.fail(failure), []) })

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ToolGateway.Runtime.Service
        return yield* Effect.exit(runtime.acquire(actor))
      }).pipe(Effect.scoped, Effect.provide(ToolGatewayRuntime.layer.pipe(Layer.provide(workspaces)))),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(ToolGateway.UnavailableError)
      expect(JSON.stringify(exit.cause)).not.toContain("sensitive activation detail")
    }
  })

  it("retains an acquired member graph until the caller request Scope closes", async () => {
    const released: string[] = []
    const workspaces = WorkspaceMap.layerFromFactory({ services: () => capabilities(Effect.void, released) })

    await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ToolGateway.Runtime.Service
        const workspaceMap = yield* WorkspaceMap.Service
        yield* runtime.acquire(actor)
        yield* workspaceMap.invalidate(actor.properties)
        expect(released).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(ToolGatewayRuntime.layer.pipe(Layer.provideMerge(workspaces)))),
    )

    expect(released).toEqual([actor.properties.workspaceID])
  })
})
