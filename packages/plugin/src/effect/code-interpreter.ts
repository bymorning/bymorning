import type { Effect, Scope } from "effect"
import type { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import type { Transform } from "./registration.js"

export interface Executor {
  readonly execute: (input: CodeInterpreter.ExecuteInput) => Effect.Effect<CodeInterpreter.Output, CodeInterpreter.ExecutionError, Scope.Scope>
}
export interface Implementation {
  readonly id: string
  readonly name: string
  readonly open: Effect.Effect<Executor, CodeInterpreter.ExecutionError, Scope.Scope>
}
export interface Editor {
  add(implementation: Implementation): void
  readonly default: { get(): string | undefined; set(implementation: string | undefined): void }
}
export interface CodeInterpreterDomain { readonly transform: Transform<Editor>; readonly reload: () => Effect.Effect<void> }
