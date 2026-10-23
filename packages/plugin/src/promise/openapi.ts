/** Public description of the host-owned OpenAPI Tool registration capability. */

import type { OpenAPI as CodeModeOpenAPI } from "@opencode-ai/codemode"
import type { Registration } from "./registration.js"
import type { ToolEditor } from "./tool.js"

export type Authentication =
  | { readonly type: "none" }
  | { readonly type: "integration"; readonly integrationID: string; readonly schemes: Readonly<Record<string, { readonly type: "bearer" } | { readonly type: "apiKey" } | { readonly type: "basic"; readonly username: string }>> }
export interface Options { readonly namespace: string; readonly permissionPrefix: string; readonly spec: CodeModeOpenAPI.Document; readonly baseURL?: string; readonly expectedOrigin: string; readonly authentication: Authentication }
export interface Summary { readonly operationNames: ReadonlyArray<string>; readonly skipped: ReadonlyArray<CodeModeOpenAPI.Skipped> }
export interface Error { readonly _tag: "Error"; readonly message: string }
export interface Domain {
  readonly transform: (callback: (editor: ToolEditor) => void) => Promise<Registration>
  readonly reload: () => Promise<void>
  readonly openapi: (options: Options) => Promise<Summary & { dispose(): Promise<void> }>
}
