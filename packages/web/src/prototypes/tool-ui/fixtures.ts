import type { SessionPermission } from "../../features/session/ui/session-permission"
import type { SessionUI } from "../../features/session/ui/session-model"

export const toolStates = ["running", "succeeded", "failed", "interrupted", "stopped"] as const
export type PrototypeToolState = (typeof toolStates)[number]

export type ToolScenario = {
  readonly kind: "tool"
  readonly id: string
  readonly family: string
  readonly title: string
  readonly note: string
  readonly tool: SessionUI.ToolPart
}

type GroupScenarioBase = {
  readonly id: string
  readonly family: string
  readonly title: string
  readonly note: string
  readonly state: "running" | "succeeded"
  readonly entries: ReadonlyArray<SessionUI.TimelinePartEntry>
}

export type ContextGroupScenario = GroupScenarioBase & { readonly kind: "context-group" }
export type FileGroupScenario = GroupScenarioBase & { readonly kind: "file-group" }

export type PermissionScenario = {
  readonly kind: "permission"
  readonly id: string
  readonly family: string
  readonly title: string
  readonly note: string
  readonly state: "running" | "succeeded" | "failed"
  readonly item: SessionPermission.Item
  readonly metadata?: SessionUI.JsonRecord
  readonly pending: boolean
  readonly error?: string
}

export type HiddenScenario = {
  readonly kind: "hidden"
  readonly id: string
  readonly family: string
  readonly title: string
  readonly note: string
  readonly state: "succeeded"
  readonly toolName: "question" | "todowrite"
}

export type PrototypeScenario = ToolScenario | ContextGroupScenario | FileGroupScenario | PermissionScenario | HiddenScenario

const state = (type: PrototypeToolState, detail?: string): SessionUI.ToolState => {
  if (type === "failed") return { type, message: detail ?? "The operation could not be completed" }
  if (type === "succeeded") return detail === undefined ? { type } : { type, output: detail }
  return { type }
}

const tool = (
  id: string,
  name: string,
  toolState: SessionUI.ToolState,
  input: SessionUI.JsonRecord = {},
  metadata: SessionUI.JsonRecord = {},
  options: { readonly summary?: string; readonly inputStreaming?: boolean } = {},
): SessionUI.ToolPart => ({ type: "tool", id, name, input, metadata, state: toolState, ...options })

const entry = (messageID: string, part: SessionUI.ToolPart): SessionUI.TimelinePartEntry => ({
  messageID,
  part,
  streaming: part.state.type === "running",
})

const patch = {
  file: "src/session/timeline.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ -18,2 +18,3 @@\n-const open = false\n+const open = true\n+render(open)",
} as const satisfies SessionUI.JsonRecord

const PROJECT_ID = "prj_00000000000000000000000001"

export function projectResource(path: string) {
  return `project:${PROJECT_ID}:${encodeURIComponent(path).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`
}

function permission(
  id: string,
  action: string,
  resources: ReadonlyArray<string>,
  note: string,
  options: {
    readonly label?: string
    readonly metadata?: SessionUI.JsonRecord
    readonly pending?: boolean
    readonly error?: string
  } = {},
): PermissionScenario {
  return {
    kind: "permission",
    id,
    family: "Permission",
    title: `Permission · ${options.label ?? action}`,
    note,
    state: options.error ? "failed" : options.pending ? "running" : "succeeded",
    item: { id: `prototype-${id}`, title: `Called ${action}`, action, resources: [...resources] },
    ...(options.metadata ? { metadata: options.metadata } : {}),
    pending: options.pending ?? false,
    ...(options.error ? { error: options.error } : {}),
  }
}

export const prototypeScenarios: ReadonlyArray<PrototypeScenario> = [
  {
    kind: "tool", id: "generic-unknown", family: "Generic / fallback", title: "Unknown tool · succeeded",
    note: "Unregistered names use GenericTool; primitive input arguments and output remain available.",
    tool: tool("generic-unknown", "custom_report", state("succeeded", "Report saved locally."), { format: "markdown", rows: 12 }, {}, { summary: "Weekly report" }),
  },
  {
    kind: "tool", id: "generic-web", family: "Generic / fallback", title: "Web fallback · running",
    note: "Web tools have no dedicated renderer and retain URL/query fallback semantics.",
    tool: tool("generic-web", "webfetch", state("running"), { url: "https://example.test/reference", format: "markdown" }),
  },
  {
    kind: "tool", id: "generic-mcp", family: "Generic / fallback", title: "MCP fallback · failed",
    note: "Unknown MCP calls dispatch through ToolDisplay, so ToolErrorCard owns the failure.",
    tool: tool("generic-mcp", "mcp_catalog_search", state("failed", "Catalog service unavailable"), { query: "design tokens" }),
  },
  {
    kind: "tool", id: "generic-task", family: "Generic / fallback", title: "Task fallback · stopped",
    note: "Legacy task names remain generic; stopped is terminal and distinct from failed.",
    tool: tool("generic-task", "task", state("stopped"), { description: "Inventory renderers" }),
  },
  {
    kind: "tool", id: "read-running", family: "Context tools", title: "Read · running",
    note: "Dedicated read renderer; pending disclosures are unavailable until output exists.",
    tool: tool("read-running", "read", state("running"), { path: "src/session/route.tsx", offset: 20, limit: 40 }),
  },
  {
    kind: "tool", id: "list-succeeded", family: "Context tools", title: "List · succeeded",
    note: "Directory subject with a compact result surface.",
    tool: tool("list-succeeded", "list", state("succeeded", "route.tsx\nroute.css\nroute.test.tsx"), { path: "src/prototypes/tool-ui/" }),
  },
  {
    kind: "tool", id: "glob-succeeded", family: "Context tools", title: "Glob · succeeded",
    note: "Pattern and include remain secondary arguments.",
    tool: tool("glob-succeeded", "glob", state("succeeded", "src/app.tsx\nsrc/session/route.tsx"), { path: "src", pattern: "**/*.tsx" }, { loaded: ["src/app.tsx"] }),
  },
  {
    kind: "tool", id: "grep-interrupted", family: "Context tools", title: "Grep · interrupted",
    note: "Interrupted is reachable but has no output detail.",
    tool: tool("grep-interrupted", "grep", state("interrupted"), { path: "src", pattern: "ToolDisplay", include: "*.tsx" }),
  },
  {
    kind: "tool", id: "write-running", family: "File tools", title: "Write · running",
    note: "Valid write input uses the production FileTool renderer while content streams.",
    tool: tool("write-running", "write", state("running"), { path: "src/prototypes/example.ts", content: "export const ready = true\n" }),
  },
  {
    kind: "tool", id: "write-succeeded", family: "File tools", title: "Write · succeeded",
    note: "Diagnostics use the exact production metadata shape.",
    tool: tool("write-succeeded", "write", state("succeeded"), { path: "src/prototypes/example.ts", content: "export const ready =\n" }, { diagnostics: { "src/prototypes/example.ts": [{ severity: 1, message: "Expression expected", range: { start: { line: 0, character: 21 } } }] } }),
  },
  {
    kind: "tool", id: "edit-succeeded", family: "File tools", title: "Edit · succeeded",
    note: "Validated file metadata is preferred over the input replacement preview.",
    tool: tool("edit-succeeded", "edit", { type: "succeeded", result: { replacements: 1 } }, { path: "src/session/timeline.ts", oldString: "const open = false", newString: "const open = true", replaceAll: true }, { files: [patch] }),
  },
  {
    kind: "tool", id: "edit-failed", family: "File tools", title: "Edit · failed",
    note: "Actual dispatch bypasses EditTool and centralizes detail in ToolErrorCard.",
    tool: tool("edit-failed", "edit", state("failed", "Replacement text was not found"), { path: "src/session/timeline.ts", oldString: "missing", newString: "replacement" }),
  },
  {
    kind: "tool", id: "write-stopped", family: "File tools", title: "Write · stopped",
    note: "Stopped remains a reachable non-failure terminal state.",
    tool: tool("write-stopped", "write", state("stopped"), { path: "src/prototypes/draft.ts", content: "// incomplete\n" }),
  },
  {
    kind: "tool", id: "shell-running", family: "Command tools", title: "Shell · running",
    note: "Metadata command fallback matches production persisted calls.",
    tool: tool("shell-running", "shell", state("running"), {}, { command: "bun test route.test.tsx" }),
  },
  {
    kind: "tool", id: "shell-succeeded", family: "Command tools", title: "Shell · succeeded",
    note: "Structured stdout/stderr result is rendered instead of serialized output.",
    tool: tool("shell-succeeded", "shell", { type: "succeeded", result: { stdout: "12 tests passed\n", stderr: "", exitCode: 0 } }, { command: "bun test route.test.tsx" }),
  },
  {
    kind: "tool", id: "execute-succeeded", family: "Command tools", title: "Execute · succeeded",
    note: "Code and output use the dedicated execute renderer.",
    tool: tool("execute-succeeded", "execute", state("succeeded", "3 renderer families"), { description: "Count renderer families", code: "const count = families.length\nreturn `${count} renderer families`" }),
  },
  {
    kind: "tool", id: "execute-interrupted", family: "Command tools", title: "Execute · interrupted",
    note: "Interrupted execution preserves code without inventing output.",
    tool: tool("execute-interrupted", "execute", state("interrupted"), { path: "scripts/inventory.ts" }),
  },
  {
    kind: "tool", id: "skill-running", family: "Skill", title: "Skill · running",
    note: "The production skill renderer is intentionally a non-disclosure loaded-item row.",
    tool: tool("skill-running", "skill", state("running"), { id: "solidjs-best-practices" }),
  },
  {
    kind: "tool", id: "skill-succeeded", family: "Skill", title: "Skill · succeeded",
    note: "Skill instructions and output are projection-hidden by the dedicated renderer.",
    tool: tool("skill-succeeded", "skill", { type: "succeeded", result: { name: "SolidJS Best Practices" }, output: "Hidden instructions" }, { id: "solidjs-best-practices" }),
  },
  {
    kind: "tool", id: "subagent-streaming", family: "Subagent", title: "Subagent · input streaming",
    note: "Compact Delegating state appears before structured input is complete.",
    tool: tool("subagent-streaming", "subagent", state("running"), {}, {}, { inputStreaming: true }),
  },
  {
    kind: "tool", id: "subagent-background", family: "Subagent", title: "Subagent · background",
    note: "A succeeded invocation with running child metadata truthfully means background work.",
    tool: tool("subagent-background", "subagent", state("succeeded"), { agent: "explore", description: "Inventory tool renderers" }, { sessionID: "00000000-0000-4000-8000-000000000010", status: "running" }),
  },
  {
    kind: "tool", id: "subagent-failed", family: "Subagent", title: "Subagent · failed",
    note: "Subagent handles its own failure to retain child-session semantics.",
    tool: tool("subagent-failed", "subagent", state("failed", "Worker context limit reached"), { agent: "explore", description: "Inspect long trace" }, { sessionID: "00000000-0000-4000-8000-000000000011" }),
  },
  {
    kind: "context-group", id: "context-group-running", family: "Grouped tools", title: "ContextToolGroup · running",
    note: "Groups support only running/succeeded mixtures; failed/interrupted/stopped are unavailable because projection groups only active/completed context calls.", state: "running",
    entries: [entry("assistant-context", tool("group-read", "read", state("running"), { path: "src/session.ts", offset: 20, limit: 40 })), entry("assistant-context", tool("group-grep", "grep", state("succeeded"), { path: "src", pattern: "ToolDisplay", include: "*.tsx" }, { matches: 2 }))],
  },
  {
    kind: "file-group", id: "file-group-succeeded", family: "Grouped tools", title: "FileToolGroup · succeeded",
    note: "Grouped files likewise expose only reachable running/succeeded combinations; invalid terminal fixtures are not generated.", state: "succeeded",
    entries: [entry("assistant-file", tool("group-edit", "edit", state("succeeded"), {}, { files: [patch, { file: "src/prototypes/route.css", status: "added", additions: 8, deletions: 0, patch: "+[data-prototype] {\n+  display: grid;\n+}" }] }))],
  },
  permission("permission-read", "read", [projectResource("src/session/route.tsx")], "Project file read uses metadata.path and the encoded project resource.", { metadata: { projectID: PROJECT_ID, path: "src/session/route.tsx" } }),
  permission("permission-read-fallback", "read", [projectResource("src/session/timeline.ts")], "Missing metadata falls back to decoding project:prj_<id>:<path>.", { label: "read fallback" }),
  permission("permission-read-invalid", "read", [`project:${PROJECT_ID}:%E0%A4%A`], "Invalid percent-encoding must not throw; the raw resource remains.", { label: "read invalid" }),
  permission("permission-write", "write", [projectResource("src/prototypes/example.ts")], "Project file write shows only the basename.", { metadata: { projectID: PROJECT_ID, path: "src/prototypes/example.ts" } }),
  permission("permission-edit", "edit", [projectResource("src/session/timeline.ts")], "Project file edit shows only the basename.", { metadata: { projectID: PROJECT_ID, path: "src/session/timeline.ts" } }),
  permission("permission-execute", "execute", [projectResource("scripts/inventory.ts")], "Project file execute shows only the basename.", { metadata: { projectID: PROJECT_ID, path: "scripts/inventory.ts", language: "typescript" } }),
  permission("permission-glob", "glob", ["**/*.tsx"], "Glob permission keeps the pattern, never a basename.", { metadata: { projectID: PROJECT_ID, pattern: "**/*.tsx", path: "src" } }),
  permission("permission-grep", "grep", ["ToolDisplay"], "Grep permission keeps the search pattern.", { metadata: { projectID: PROJECT_ID, pattern: "ToolDisplay", path: "src", include: "*.tsx" } }),
  permission("permission-shell", "shell", ["bun test route.test.tsx"], "Shell permission uses the command as the resource.", { metadata: { command: "bun test route.test.tsx" } }),
  permission("permission-skill", "skill", ["solidjs-best-practices"], "Skill permission loads one Skill ID.", { metadata: { skillID: "solidjs-best-practices" } }),
  permission("permission-subagent", "subagent", ["explore"], "Subagent permission delegates to one agent ID."),
  permission("permission-websearch", "websearch", ["design tokens"], "Web search permission uses the query.", { metadata: { query: "design tokens" } }),
  permission("permission-webfetch", "webfetch", ["https://example.test/reference"], "Web fetch permission uses the URL.", { metadata: { url: "https://example.test/reference", format: "markdown" } }),
  permission("permission-tool-output", "tool_output", ["out_00000000000000000000000001"], "Stored output permission omits the opaque ID from the sentence.", { label: "tool_output", metadata: { outputID: "out_00000000000000000000000001", cursor: 0 } }),
  permission("permission-question", "question", ["*"], "Question permission omits the wildcard resource."),
  permission("permission-config-get", "config_get", ["gateway", "permissions"], "Config read lists every requested key.", { label: "config_get" }),
  permission("permission-config-update", "config_update", ["permissions"], "Config update names the keys being changed.", { label: "config_update" }),
  permission("permission-mcp-connect", "mcp_connect", ["docs-server"], "MCP connect names the server.", { label: "mcp_connect" }),
  permission("permission-mcp-list", "mcp_list", ["mcp"], "MCP list omits the generic mcp resource.", { label: "mcp_list" }),
  permission("permission-integration", "integration_connect", ["amazon-bedrock"], "Integration connect names the Integration.", { label: "integration_connect" }),
  permission("permission-mcp-outbound", "docs_search", ["*"], "Outbound MCP tools fall back to call <action>.", { label: "mcp outbound" }),
  permission("permission-openapi", "local_ping", ["https://api.example.test"], "OpenAPI tools fall back to call <action> on the origin.", { label: "openapi" }),
  permission("permission-plugin", "custom_report", ["*"], "Plugin sandbox tools fall back to call <action>.", { label: "plugin" }),
  permission("permission-pending", "read", [projectResource("src/session/route.tsx")], "Pending is aria-busy and disabled, with no status indicator.", { label: "pending", pending: true, metadata: { projectID: PROJECT_ID, path: "src/session/route.tsx" } }),
  permission("permission-error", "read", [projectResource("src/session/route.tsx")], "Error remains a role=alert on the same request.", { label: "error", error: "Permission response could not be saved", metadata: { projectID: PROJECT_ID, path: "src/session/route.tsx" } }),
  ...(["question", "todowrite"] as const).map((toolName): HiddenScenario => ({
    kind: "hidden", id: `hidden-${toolName}`, family: "Projection-hidden", title: `${toolName} · projection-hidden`,
    note: `${toolName} is intentionally removed by timeline projection; there is no truthful current card to render.`, state: "succeeded", toolName,
  })),
]

export const prototypeFamilies = ["All", ...new Set(prototypeScenarios.map((scenario) => scenario.family))]
