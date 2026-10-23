import type { Transform } from "./registration.js"
import type { CodeInterpreter } from "@bymorning/schema/code-interpreter"

export interface Executor {
  readonly execute: (input: CodeInterpreter.ExecuteInput, context: { readonly signal: AbortSignal }) => Promise<CodeInterpreter.Output>
}
export interface Implementation {
  readonly id: string
  readonly name: string
  readonly open: (context: { readonly signal: AbortSignal }) => Promise<Executor>
}
export interface Editor {
  add(implementation: Implementation): void
  readonly default: { get(): string | undefined; set(implementation: string | undefined): void }
}
export interface CodeInterpreterDomain { readonly transform: Transform<Editor>; readonly reload: () => Promise<void> }
