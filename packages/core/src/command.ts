export * as Command from "./command.js"

import type { CommandEditor } from "@bymorning/plugin/effect/command"
import { Event, type Info } from "@bymorning/schema/command"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Bus } from "./bus.js"
import { Shell } from "./shell.js"
import { State } from "./state.js"
import { makeWorkspaceNode, tags, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Command.NotFoundError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export class EvaluationError extends Schema.TaggedError<EvaluationError>()("Command.EvaluationError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export interface Interface extends State.Transformable<CommandEditor> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly list: () => Effect.Effect<Info[]>
  readonly evaluate: (input: {
    readonly name: string
    readonly arguments?: string
  }) => Effect.Effect<{ readonly text: string }, NotFoundError | EvaluationError>
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Command") {}

export const layer = (cwd: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const shell = yield* Shell.Service
      const state = State.create<Map<string, Types.DeepMutable<Info>>, CommandEditor>({
        name: "command",
        initial: () => new Map(),
        editor: (commands) => ({
          list: () => Array.from(commands.values()),
          get: (name) => commands.get(name),
          update: (name, update) => {
            const current = commands.get(name) ?? { name, template: "" }
            if (!commands.has(name)) commands.set(name, current)
            update(current)
            current.name = name
          },
          remove: (name) => {
            commands.delete(name)
          },
        }),
        notify: () => bus.publish(Event.Updated, {}).pipe(Effect.orDie, Effect.asVoid),
      })

      return Service.of({
        transform: state.transform,
        reload: state.reload,
        get: Effect.fn("Command.get")((name) => Effect.succeed(state.get().get(name))),
        list: Effect.fn("Command.list")(() => Effect.succeed(Array.from(state.get().values()))),
        evaluate: Effect.fn("Command.evaluate")(function* (input) {
          const command = state.get().get(input.name)
          if (!command) {
            return yield* new NotFoundError({ command: input.name, message: `Command not found: ${input.name}` })
          }
          const expanded = evaluateArguments(command.template, input.arguments ?? "")
          const matches = Array.from(expanded.matchAll(shellRegex))
          if (matches.length === 0) return { text: expanded }
          const outputs = yield* Effect.forEach(
            matches,
            (match) =>
              shell.run({ command: match[1] ?? "", cwd }).pipe(
                Effect.mapError(
                  (error) =>
                    new EvaluationError({
                      command: input.name,
                      message: `Shell interpolation failed for ${JSON.stringify(match[1] ?? "")}: ${error.message}`,
                    }),
                ),
              ),
            { concurrency: 2 },
          )
          const iterator = outputs[Symbol.iterator]()
          return { text: expanded.replace(shellRegex, () => iterator.next().value ?? "") }
        }),
      })
    }),
  )

/** Build Command with the host-selected working directory. */
export const configured = (cwd: string) =>
  makeWorkspaceNode({ service: Service, layer: layer(cwd), deps: [Bus.node, Shell.node] })

/** Host-bound Command declaration; bind it once with `configured(cwd)`. */
export const node = LayerNode.unbound<
  Service,
  Interface,
  typeof tags.values.workspace,
  LayerNode.Error<ReturnType<typeof configured>>
>(Service, tags.values.workspace)

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly cwd: string
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly shell: WorkspaceNode<Shell.Service, E>
}) => makeWorkspaceNode({ service: Service, layer: layer(input.cwd), deps: [input.bus, input.shell] })

function evaluateArguments(template: string, input: string) {
  const args = (input.match(argsRegex) ?? []).map((argument) => argument.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  const last = Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
  const expanded = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argument = position - 1
    if (argument >= args.length) return ""
    if (position === last) return args.slice(argument).join(" ")
    return args[argument] ?? ""
  })
  const withArguments = expanded.replaceAll("$ARGUMENTS", input)
  if (placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()) {
    return `${withArguments}\n\n${input}`.trim()
  }
  return withArguments.trim()
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const shellRegex = /!`([^`]+)`/g
