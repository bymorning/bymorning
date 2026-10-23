export * as ConfigCodeInterpreter from "./code-interpreter.js"

import { CodeInterpreter } from "../code-interpreter.js"

/** Explicit Workspace code-execution implementation selection. */
export const Selection = CodeInterpreter.Selection
export type Selection = typeof Selection.Type
