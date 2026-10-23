export * as Shell from "./shell.js"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { PluginHooks } from "./plugin/hooks.js"
import { AppProcess } from "./util/process.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

export interface RunInput {
  readonly command: string
  readonly cwd: string
  readonly timeout?: number
  readonly shell?: string
  readonly env?: Record<string, string | undefined>
}

export interface Interface {
  readonly run: (input: RunInput) => Effect.Effect<string, AppProcess.AppProcessError>
}

/** Non-interactive shell authority with the mutable Plugin hook boundary applied before spawn. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Shell") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const processes = yield* AppProcess.Service
    return Service.of({
      run: Effect.fn("Shell.run")(function* (input) {
        const command = yield* hooks.trigger("shell", "create.before", {
          command: input.command,
          cwd: input.cwd,
          timeout: input.timeout ?? 0,
          shell: input.shell ?? process.env.SHELL ?? "/bin/sh",
          env: { ...input.env },
        })
        const result = yield* processes.run(
          ChildProcess.make(command.shell, ["-lc", command.command], {
            cwd: command.cwd,
            env: command.env,
            extendEnv: true,
            stdin: "ignore",
          }),
          {
            combineOutput: true,
            ...(command.timeout > 0 ? { timeout: command.timeout } : {}),
          },
        )
        return (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")
      }),
    })
  }),
)

/** Canonical Shell node over workspace hooks and process execution authority. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [PluginHooks.node, AppProcess.node] })

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(hooks: WorkspaceNode<PluginHooks.Service, E>) =>
  makeWorkspaceNode({ service: Service, layer, deps: [hooks, AppProcess.node] })
