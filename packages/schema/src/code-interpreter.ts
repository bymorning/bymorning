export * as CodeInterpreter from "./code-interpreter.js"
export * as CodeInterpreterSchema from "./code-interpreter.js"

import { Schema } from "effect"
import { Tool } from "./tool.js"

const Operation = Schema.Literals(["start", "invoke", "stream", "output"])

/** Input required to execute one isolated shell command. */
export const ExecuteCommandInput = Schema.Struct({ type: Schema.Literal("command"), sessionName: Schema.String, command: Schema.String })
export type ExecuteCommandInput = typeof ExecuteCommandInput.Type

/** Input required to execute source code in a pinned language. */
export const ExecuteCodeInput = Schema.Struct({ type: Schema.Literal("code"), sessionName: Schema.String, code: Schema.String, language: Tool.Language })
export type ExecuteCodeInput = typeof ExecuteCodeInput.Type

/** One isolated command or source-code execution. */
export const ExecuteInput = Schema.Union([ExecuteCommandInput, ExecuteCodeInput])
export type ExecuteInput = typeof ExecuteInput.Type

/** Captured output from one isolated Code Interpreter invocation. */
export const Output = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, exitCode: Schema.optionalKey(Schema.Finite) })
export type Output = typeof Output.Type

/** Expected plugin execution failure. */
export class ExecutionError extends Schema.TaggedError<ExecutionError>()("CodeInterpreter.ExecutionError", {
  operation: Operation,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Registered code-execution implementation identifier. */
export const ID = Schema.String.pipe(Schema.brand("CodeInterpreter.ID"))
export type ID = typeof ID.Type

/** Secret-free registered code-execution implementation. */
export const Info = Schema.Struct({ id: ID, name: Schema.String }).annotate({ identifier: "CodeInterpreter.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Workspace selection of one registered implementation. */
export const Selection = Schema.Struct({ implementation: ID })
export type Selection = typeof Selection.Type
