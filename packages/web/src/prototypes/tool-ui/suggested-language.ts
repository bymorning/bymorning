import type { PermissionScenario, PrototypeScenario, ToolScenario } from "./fixtures"

export type DisplayResource = {
  readonly visible: string
  readonly accessible: string
  readonly title?: string
  readonly mono: boolean
}

export type PermissionCopy = {
  readonly preamble: string
  readonly action: string
  readonly resources: ReadonlyArray<DisplayResource>
  readonly accessible: string
}

export type ToolSubject = {
  readonly visible: string
  readonly accessible: string
  readonly title?: string
  readonly mono: boolean
}

export type ToolCopy = {
  readonly verb: string
  readonly subject?: ToolSubject
  readonly kind?: string
  readonly secondary?: string
  readonly accessible: string
  readonly failed: boolean
  readonly hideVisual: boolean
}

const preamble = "Asking permission to"
const projectResource = /^project:(prj_[0-9A-Za-z]{26}):(.+)$/
const readTools = new Set(["read", "list", "glob", "grep", "skill"])
const writeTools = new Set(["write", "edit"])
const runTools = new Set(["shell", "execute"])
const stems = {
  read: { running: "Reading", succeeded: "Read", bare: "Read" },
  write: { running: "Writing", succeeded: "Wrote", bare: "Write" },
  run: { running: "Running", succeeded: "Ran", bare: "Run" },
  delegate: { running: "Delegating", succeeded: "Delegated", bare: "Delegate" },
  call: { running: "Calling", succeeded: "Called", bare: "Call" },
} as const
const prefixes = { failed: "Failed", interrupted: "Interrupted", stopped: "Stopped" } as const
const permissionRules: Record<string, PermissionRule> = {
  read: { type: "file", action: "read" },
  write: { type: "file", action: "write" },
  edit: { type: "file", action: "edit" },
  execute: { type: "file", action: "execute" },
  glob: { type: "pattern", action: "match" },
  grep: { type: "pattern", action: "search" },
  shell: { type: "command", action: "run" },
  skill: { type: "id", action: "load", key: "skillID" },
  subagent: { type: "id", action: "delegate to" },
  websearch: { type: "query", action: "search the web for", key: "query" },
  webfetch: { type: "url", action: "fetch", key: "url" },
  tool_output: { type: "phrase", action: "read stored output", omit: true },
  question: { type: "phrase", action: "ask questions", omit: true },
  config_get: { type: "keys", action: "read" },
  config_update: { type: "keys", action: "update" },
  mcp_connect: { type: "id", action: "connect" },
  mcp_list: { type: "phrase", action: "list MCP servers", omit: true },
  integration_connect: { type: "id", action: "connect Integration" },
}

type PermissionRule =
  | { readonly type: "file"; readonly action: string }
  | { readonly type: "pattern"; readonly action: string }
  | { readonly type: "command"; readonly action: string }
  | { readonly type: "query"; readonly action: string; readonly key: string }
  | { readonly type: "url"; readonly action: string; readonly key: string }
  | { readonly type: "id"; readonly action: string; readonly key?: string }
  | { readonly type: "keys"; readonly action: string }
  | { readonly type: "phrase"; readonly action: string; readonly omit?: true }

type Family = keyof typeof stems

export function permissionCopy(scenario: PermissionScenario): PermissionCopy {
  const rule = permissionRules[scenario.item.action]
  const resources = rule
    ? resourcesFor(rule, scenario.item.resources, scenario.metadata ?? {})
    : meaningful(scenario.item.resources).map((resource) => token(resource, true))
  const action = rule
    ? rule.action
    : resources.length > 0
      ? `call ${scenario.item.action} on`
      : `call ${scenario.item.action}`
  return { preamble, action, resources, accessible: sentence(action, resources.map((resource) => resource.accessible)) }
}

export function toolCopy(scenario: PrototypeScenario): ToolCopy {
  if (scenario.kind === "hidden") return phrase("Omitted", text(scenario.toolName), false)
  if (scenario.kind === "permission") return phrase("", undefined, false)
  if (scenario.kind === "context-group") {
    return phrase(stem("read", scenario.state), text(`${scenario.entries.length} context calls`), false)
  }
  if (scenario.kind === "file-group") {
    const files = scenario.entries.flatMap((entry) => {
      const value = entry.part.type === "tool" ? entry.part.metadata.files : undefined
      return Array.isArray(value) ? value : []
    })
    return phrase(stem("write", scenario.state), text(`${files.length} files`), false)
  }
  return toolScenarioCopy(scenario)
}

export function decodeProjectPath(resource: string) {
  const match = projectResource.exec(resource)
  if (!match) return undefined
  try {
    return decodeURIComponent(match[2]!)
  } catch {
    return undefined
  }
}

export function basename(path: string) {
  return path.split(/[\\/]/).at(-1) || path
}

function toolScenarioCopy(scenario: ToolScenario): ToolCopy {
  const state = scenario.tool.state.type
  const failed = state === "failed"
  if (scenario.tool.name === "skill") return skillCopy(scenario, state, failed)
  if (scenario.tool.name === "subagent") return subagentCopy(scenario, state, failed)
  if (runTools.has(scenario.tool.name)) return phrase(stem("run", state), commandSubject(scenario), failed)
  if (scenario.tool.name === "glob" || scenario.tool.name === "grep") {
    return phrase(stem("read", state), patternSubject(scenario), failed)
  }
  if (scenario.tool.name === "list") return phrase(stem("read", state), pathSubject(scenario), failed)
  if (readTools.has(scenario.tool.name) || writeTools.has(scenario.tool.name)) {
    return phrase(stem(writeTools.has(scenario.tool.name) ? "write" : "read", state), fileSubject(scenario), failed)
  }
  return phrase(stem("call", state), genericSubject(scenario), failed)
}

function skillCopy(scenario: ToolScenario, state: ToolScenario["tool"]["state"]["type"], failed: boolean): ToolCopy {
  const name = skillName(scenario)
  const verb = stem("read", state)
  return {
    verb,
    kind: "skill",
    accessible: [verb, name, "skill"].filter(Boolean).join(" "),
    failed,
    hideVisual: false,
    ...(name ? { subject: text(name, false) } : {}),
  }
}

function subagentCopy(scenario: ToolScenario, state: ToolScenario["tool"]["state"]["type"], failed: boolean): ToolCopy {
  const agent = stringValue(scenario.tool.input.agent)
  const description = stringValue(scenario.tool.input.description)
  if (!agent) return phrase(state === "running" ? "Delegating" : stem("delegate", state), undefined, failed)
  const verb = `${stem("delegate", state)} to`
  return {
    verb,
    subject: text(agent, false),
    kind: "agent",
    accessible: [verb, agent, "agent", description].filter(Boolean).join(" "),
    failed,
    hideVisual: false,
    ...(description ? { secondary: description } : {}),
  }
}

function phrase(verb: string, subject: ToolSubject | undefined, failed: boolean): ToolCopy {
  return {
    verb,
    accessible: [verb, subject?.accessible].filter(Boolean).join(" "),
    failed,
    hideVisual: subject !== undefined && subject.visible !== subject.accessible,
    ...(subject ? { subject } : {}),
  }
}

function stem(family: Family, state: string) {
  const form = stems[family]
  if (state === "running") return form.running
  if (state === "succeeded") return form.succeeded
  if (state === "failed" || state === "interrupted" || state === "stopped") return `${prefixes[state]} ${form.bare}`
  return form.succeeded
}

function fileSubject(scenario: ToolScenario): ToolSubject | undefined {
  const path = stringValue(scenario.tool.input.path)
  if (!path) return undefined
  return { visible: basename(path), accessible: path, title: path, mono: true }
}

function pathSubject(scenario: ToolScenario): ToolSubject | undefined {
  const path = stringValue(scenario.tool.input.path)
  return path ? { visible: path, accessible: path, title: path, mono: true } : undefined
}

function patternSubject(scenario: ToolScenario): ToolSubject | undefined {
  const pattern = stringValue(scenario.tool.input.pattern)
  return pattern ? { visible: pattern, accessible: pattern, mono: true } : undefined
}

function commandSubject(scenario: ToolScenario): ToolSubject | undefined {
  if (scenario.tool.name === "execute") {
    const description = stringValue(scenario.tool.input.description)
    if (description) return text(description, false)
    const code = stringValue(scenario.tool.input.code)
    if (code) {
      const line = code.split("\n")[0] ?? code
      return { visible: line, accessible: line, mono: true }
    }
    const path = stringValue(scenario.tool.input.path)
    return path ? { visible: path, accessible: path, title: path, mono: true } : undefined
  }
  const command = stringValue(scenario.tool.input.command) ?? stringValue(scenario.tool.metadata.command)
  return command ? { visible: command, accessible: command, title: command, mono: true } : undefined
}

function genericSubject(scenario: ToolScenario): ToolSubject | undefined {
  const summary = stringValue(scenario.tool.summary)
  if (summary) return text(summary, false)
  for (const key of ["url", "query", "path", "description"] as const) {
    const value = stringValue(scenario.tool.input[key])
    if (!value) continue
    const first = value.split("\n")[0] ?? value
    const mono = key === "url" || key === "path"
    return { visible: first, accessible: first, mono, ...(mono ? { title: value } : {}) }
  }
  return text(scenario.tool.name, false)
}

function skillName(scenario: ToolScenario) {
  if (typeof scenario.tool.metadata.name === "string") return scenario.tool.metadata.name
  const result = scenario.tool.state.type === "succeeded" ? scenario.tool.state.result : undefined
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const name = Reflect.get(result, "name")
    if (typeof name === "string") return name
  }
  return stringValue(scenario.tool.input.id) ?? stringValue(scenario.tool.input.name)
}

function resourcesFor(rule: PermissionRule, resources: ReadonlyArray<string>, metadata: Record<string, unknown>) {
  if (rule.type === "file") return fileResources(resources, metadata)
  if (rule.type === "pattern") return tokens(stringValue(metadata.pattern) ?? first(resources), true)
  if (rule.type === "command") return tokens(stringValue(metadata.command) ?? first(resources), true)
  if (rule.type === "query") return tokens(stringValue(metadata[rule.key]) ?? first(resources), false)
  if (rule.type === "url") return tokens(stringValue(metadata[rule.key]) ?? first(resources), true)
  if (rule.type === "id") return tokens(stringValue(rule.key ? metadata[rule.key] : undefined) ?? first(resources), true)
  if (rule.type === "keys") return meaningful(resources).map((resource) => token(resource, true))
  return []
}

function fileResources(resources: ReadonlyArray<string>, metadata: Record<string, unknown>): DisplayResource[] {
  if (typeof metadata.reference === "string") {
    const nested = stringValue(metadata.path)
    const value = nested ? `reference:${metadata.reference}/${nested}` : `reference:${metadata.reference}`
    return [token(value, true)]
  }
  const path = stringValue(metadata.path)
  const paths = path
    ? [path]
    : resources.flatMap((resource) => {
        const decoded = decodeProjectPath(resource)
        if (decoded) return [decoded]
        return meaningful([resource])
      })
  if (paths.length > 4) {
    const accessible = paths.join(", ")
    return [{ visible: `${paths.length} files`, accessible, title: accessible, mono: false }]
  }
  return paths.map((value) => {
    const fromProject = resources.some((resource) => decodeProjectPath(resource) === value)
    if (path || fromProject) {
      return { visible: basename(value), accessible: value, title: value, mono: true }
    }
    return token(value, true)
  })
}

function tokens(value: string | undefined, mono: boolean) {
  return value && value !== "*" ? [token(value, mono)] : []
}

function token(value: string, mono: boolean): DisplayResource {
  return { visible: value, accessible: value, title: value, mono }
}

function text(value: string, mono = false): ToolSubject {
  return { visible: value, accessible: value, mono }
}

function first(resources: ReadonlyArray<string>) {
  return meaningful(resources)[0]
}

function meaningful(resources: ReadonlyArray<string>) {
  return resources.filter((resource) => resource !== "" && resource !== "*")
}

function sentence(action: string, resources: ReadonlyArray<string>) {
  return resources.length === 0 ? `${preamble} ${action}?` : `${preamble} ${action} ${resources.join(", ")}?`
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}
