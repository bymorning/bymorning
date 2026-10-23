import { Plugin } from "@bymorning/core/plugin"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { makeGlobalNode, type GlobalNode } from "@bymorning/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { WorkspaceMap } from "./workspace-map.js"

export * as ToolGatewayRuntime from "./tool-gateway-runtime.js"

/** Adapt the server's retained member graph to the Gateway package's runtime acquisition seam. */
export const layer = Layer.effect(
  ToolGateway.Runtime.Service,
  Effect.map(WorkspaceMap.Service, (workspaces) =>
    ToolGateway.Runtime.Service.of({
      acquire: (actor) =>
        Effect.gen(function* () {
          const context = yield* workspaces.contextEffect(actor.properties)
          yield* Context.get(context, Plugin.Service).awaitActivation.pipe(
            Effect.mapError(() => new ToolGateway.UnavailableError()),
          )
          return Context.get(context, ToolGateway.Member.Service)
        }),
    }),
  ),
)

export const node = <E>(workspaces: GlobalNode<WorkspaceMap.Service, E>) =>
  makeGlobalNode({ service: ToolGateway.Runtime.Service, layer, deps: [workspaces] })
