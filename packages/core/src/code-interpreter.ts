export * as CodeInterpreter from "./code-interpreter.js"

import { CodeInterpreterSchema } from "@bymorning/schema/code-interpreter"
import type { Tool } from "@bymorning/schema/tool"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { State } from "./state.js"

const OUTPUT_LIMIT = 100_000
const SESSION_TIMEOUT_SECONDS = 900

export type Output = CodeInterpreterSchema.Output
export const ExecutionError = CodeInterpreterSchema.ExecutionError
export type ExecutionError = CodeInterpreterSchema.ExecutionError

/** Human-readable failure text for an absent implementation, shown to users and models. */
export const UNAVAILABLE_MESSAGE = "Code Interpreter is unavailable right now."

/** The selected implementation is absent from the active Workspace registry. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("CodeInterpreter.UnavailableError", {}) {}

/**
 * User-facing failure reason: the shared unavailable message for an absent implementation,
 * otherwise the error's own message, or a generic sentence when it reported none.
 */
export const reason = (error: { readonly _tag: string; readonly message: string }): string =>
  error._tag === "CodeInterpreter.UnavailableError"
    ? UNAVAILABLE_MESSAGE
    : error.message.trim() || "the execution failed without reporting a reason"

export type ExecuteInput = CodeInterpreterSchema.ExecuteInput

/** Isolated command and source-code execution capability. */
export interface Executor {
  readonly execute: (input: ExecuteInput) => Effect.Effect<Output, ExecutionError, Scope.Scope>
}

/** A lifecycle-scoped implementation contributed by a plugin or startup adapter. */
export interface Implementation {
  readonly id: string
  readonly name: string
  readonly open: Effect.Effect<Executor, ExecutionError, Scope.Scope>
}

export interface Editor {
  add(implementation: Implementation): void
  readonly default: {
    get(): string | undefined
    set(implementation: string | undefined): void
  }
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: () => Effect.Effect<readonly CodeInterpreterSchema.Info[]>
  readonly default: () => Effect.Effect<CodeInterpreterSchema.Info | undefined>
  readonly execute: (input: ExecuteInput) => Effect.Effect<Output, ExecutionError | UnavailableError, Scope.Scope>
}

/** Isolated command and source-code execution service. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/CodeInterpreter") {}

interface Data { readonly implementations: Map<string, Implementation>; selection: string | undefined }

/** Workspace registry. The initial selection is installation startup policy. */
export const layer = (selection?: string) =>
  Layer.effect(Service, Effect.gen(function* () {
    const state = State.create<Data, Editor>({
      name: "code-interpreter",
      initial: () => ({ implementations: new Map(), selection }),
      editor: (data) => ({
        add: (implementation) => {
          if (data.implementations.has(implementation.id)) throw new Error(`Duplicate Code Interpreter ID: ${implementation.id}`)
          data.implementations.set(implementation.id, implementation)
        },
        default: { get: () => data.selection, set: (id) => { data.selection = id } },
      }),
    })
    const info = (implementation: Implementation): CodeInterpreterSchema.Info => ({
      id: CodeInterpreterSchema.ID.make(implementation.id), name: implementation.name,
    })
    const selected = () => {
      const id = state.get().selection
      return id === undefined ? undefined : state.get().implementations.get(id)
    }
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: () => Effect.sync(() => Array.from(state.get().implementations.values(), info).toSorted((a, b) => a.name.localeCompare(b.name))),
      default: () => Effect.sync(() => { const implementation = selected(); return implementation && info(implementation) }),
      execute: Effect.fn("CodeInterpreter.execute")(function* (input) {
        const implementation = selected()
        if (implementation === undefined) return yield* new UnavailableError()
        // Opening is deliberately inside the invocation Scope: a later registry reload cannot close these resources.
        const executor = yield* implementation.open
        return yield* executor.execute(input)
      }),
    })
  }))

export const node = makeWorkspaceNode({ service: Service, layer: layer(), deps: [State.node] })

/** Empty registry for applications that intentionally install no implementation. */
export const unavailable = layer()

/** Test adapter retaining the registry contract around one deterministic executor. */
export const fixed = (executor: Executor, id = "test"): Interface => {
  const state = State.create<Data, Editor>({
    initial: () => ({
      implementations: new Map<string, Implementation>([[id, { id, name: id, open: Effect.succeed(executor) }]]),
      selection: id,
    }),
    editor: (data) => ({
      add: (implementation) => {
        if (data.implementations.has(implementation.id)) throw new Error(`Duplicate Code Interpreter ID: ${implementation.id}`)
        data.implementations.set(implementation.id, implementation)
      },
      default: { get: () => data.selection, set: (value) => { data.selection = value } },
    }),
  })
  const selected = () => state.get().selection === undefined ? undefined : state.get().implementations.get(state.get().selection!)
  return {
    transform: state.transform,
    reload: state.reload,
    list: () => Effect.sync(() => Array.from(state.get().implementations.values(), ({ id, name }) => ({ id: CodeInterpreterSchema.ID.make(id), name }))),
    default: () => Effect.sync(() => { const value = selected(); return value && { id: CodeInterpreterSchema.ID.make(value.id), name: value.name } }),
    execute: (input) =>
      Effect.gen(function* () {
        const implementation = selected()
        if (implementation === undefined) return yield* new UnavailableError()
        const value = yield* implementation.open
        return yield* value.execute(input)
      }),
  }
}

/** Infer an executeCode language from one supported source-file extension. */
export const languageForPath = (path: string): Tool.Language | undefined => {
  if (path.endsWith(".py")) return "python"
  if (path.endsWith(".js")) return "javascript"
  if (path.endsWith(".ts")) return "typescript"
  return undefined
}
