/** Public description of the host-owned OpenAPI Tool registration capability. */

import type { OpenAPI as CodeModeOpenAPI } from "@opencode-ai/codemode"
import { Schema, type Effect, type Scope } from "effect"
import type { Registration, Transform } from "./registration.js"
import type { ToolEditor } from "./tool.js"

export type Authentication =
  | { readonly type: "none" }
  | { readonly type: "integration"; readonly integrationID: string; readonly schemes: Readonly<Record<string, { readonly type: "bearer" } | { readonly type: "apiKey" } | { readonly type: "basic"; readonly username: string }>> }
export interface Options { readonly namespace: string; readonly permissionPrefix: string; readonly spec: CodeModeOpenAPI.Document; readonly baseURL?: string; readonly expectedOrigin: string; readonly authentication: Authentication }
export interface Summary { readonly operationNames: ReadonlyArray<string>; readonly skipped: ReadonlyArray<CodeModeOpenAPI.Skipped> }
export class Error extends Schema.TaggedError<Error>()("Error", { message: Schema.String }) {}
export interface Domain {
  readonly transform: Transform<ToolEditor>
  readonly reload: () => Effect.Effect<void>
  readonly openapi: (options: Options) => Effect.Effect<Summary & Registration, Error, Scope.Scope>
}
