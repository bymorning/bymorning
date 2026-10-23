import { Dynamic } from "solid-js/web"
import { For, Match, Show, Switch, type JSX } from "solid-js"

import { useSession } from "../context/session"
import type { SessionUI } from "../model"
import type { SessionID } from "@bymorning/client/solid"

type AssistantTool = SessionUI.ToolPart
type JsonRecord = Readonly<Record<string, unknown>>

/** The unmodified generated assistant tool part and its presentation callbacks. */
export type ToolProps = SessionUI.ToolProps

export function ToolDisplay(props: ToolProps): JSX.Element {
  const session = useSession()
  const custom = () => session.tools().get(props.part.name)
  return (
    <Show when={custom()} fallback={<BuiltinTool {...props} />}>
      {(tool) => (
        <Show
          when={props.part.state.status === "error" && tool().failure}
          fallback={<Dynamic component={tool().render} {...props} />}
        >
          {(failure) => (
            <Dynamic
              component={failure()}
              error={props.part.state.status === "error" ? props.part.state.error.message : ""}
            />
          )}
        </Show>
      )}
    </Show>
  )
}

function BuiltinTool(props: ToolProps): JSX.Element {
  const name = () => props.part.name
  return (
    <Switch>
      <Match when={name() === "execute" || name() === "shell"}>
        <TerminalTool {...props} />
      </Match>
      <Match when={name() === "read" || name() === "list" || name() === "glob" || name() === "grep"}>
        <ContextTool {...props} />
      </Match>
      <Match when={name() === "write" || name() === "edit"}>
        <FileTool {...props} />
      </Match>
      <Match when={name() === "subagent" || name() === "task"}>
        <SubagentTool {...props} />
      </Match>
      <Match when={name() === "skill"}>
        <SkillTool {...props} />
      </Match>
      <Match when={true}>
        <GenericTool {...props} />
      </Match>
    </Switch>
  )
}

function Card(
  props: ToolProps & {
    readonly title: string
    readonly summary: string | undefined
    readonly preview?: JSX.Element
    readonly children?: JSX.Element
  },
) {
  const session = useSession()
  const open = () => props.open()
  const setOpen = (value: boolean) => {
    props.setOpen(value)
  }
  const status = () => props.part.state.status
  return (
    <section data-component="tool" data-tool={props.part.name} data-status={status()}>
      <button type="button" data-slot="tool-trigger" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <strong>{props.title}</strong>
        <Show when={props.summary}>
          <bdi data-slot="tool-summary">{props.summary}</bdi>
        </Show>
        <span data-slot="tool-status">{session.labels().statusLabel({ status: status() })}</span>
      </button>
      <Show when={open()} fallback={props.preview}>
        <div data-slot="tool-content">{props.children}</div>
      </Show>
    </section>
  )
}

function TerminalTool(props: ToolProps) {
  const session = useSession()
  const input = () => inputOf(props.part)
  const command = () => stringAt(input(), "command") ?? stringAt(input(), "code") ?? stringAt(input(), "path")
  const result = () => outputOf(props.part)
  return (
    <Card
      {...props}
      title={props.part.name === "shell" ? session.labels().toolShell : session.labels().toolCalled}
      summary={command()}
    >
      <Show when={command()}>
        {(value) => (
          <pre data-slot="tool-command">
            <code>{value()}</code>
          </pre>
        )}
      </Show>
      <Show when={result()}>
        {(value) => (
          <pre data-slot="tool-output">
            <code>{value()}</code>
          </pre>
        )}
      </Show>
    </Card>
  )
}

function ContextTool(props: ToolProps) {
  const session = useSession()
  const input = () => inputOf(props.part)
  const summary = () => stringAt(input(), "path") ?? stringAt(input(), "pattern")
  const output = () => outputOf(props.part)
  return (
    <Card
      {...props}
      title={session.labels().toolRead}
      summary={summary()}
      preview={<Show when={output()}>{(value) => <pre data-slot="tool-output">{value()}</pre>}</Show>}
    >
      <dl data-slot="tool-input">
        <For each={entries(input())}>
          {([key, value]) => (
            <>
              <dt>{key}</dt>
              <dd>{json(value)}</dd>
            </>
          )}
        </For>
      </dl>
      <Show when={output()}>{(value) => <pre data-slot="tool-output">{value()}</pre>}</Show>
    </Card>
  )
}

function FileTool(props: ToolProps) {
  return props.part.name === "edit" ? <EditTool {...props} /> : <WriteTool {...props} />
}

function WriteTool(props: ToolProps) {
  const session = useSession()
  const input = () => validWrite(inputOf(props.part))
  const diagnostics = () => diagnosticsFor(metadataOf(props.part), input()?.path)
  return (
    <Card {...props} title={session.labels().toolWrite} summary={input()?.path}>
      <Show when={input()}>
        {(value) => (
          <>
            <button type="button" data-slot="tool-file" onClick={() => props.onFileOpen?.(value().path)}>
              {value().path}
            </button>
            <pre data-slot="tool-source">{value().content}</pre>
            <Diagnostics diagnostics={diagnostics()} />
            <ToolFiles tool={props.part} />
          </>
        )}
      </Show>
      <Show when={!input()}>
        <GenericTool {...props} />
      </Show>
    </Card>
  )
}

function EditTool(props: ToolProps) {
  const session = useSession()
  const input = () => validEdit(inputOf(props.part))
  const diff = () => fileDiff(metadataOf(props.part))
  const diagnostics = () => diagnosticsFor(metadataOf(props.part), diff()?.path ?? input()?.path)
  const replacements = () => integerAt(resultOf(props.part), "replacements")
  return (
    <Card {...props} title={session.labels().toolWrite} summary={diff()?.path ?? input()?.path}>
      <Show when={input()}>
        {(value) => (
          <>
            <button
              type="button"
              data-slot="tool-file"
              onClick={() => props.onFileOpen?.(diff()?.path ?? value().path)}
            >
              {diff()?.path ?? value().path}
            </button>
            <Show when={value().replaceAll}>
              <p data-slot="tool-context">
                {replacements() === undefined
                  ? session.labels().toolCalled
                  : `${replacements()} ${session.labels().toolCalled}`}
              </p>
            </Show>
            <Show
              when={diff()}
              fallback={
                <div data-slot="tool-diff">
                  <pre data-change="remove">{value().oldString}</pre>
                  <pre data-change="add">{value().newString}</pre>
                </div>
              }
            >
              {(change) => (
                <div data-slot="tool-diff">
                  <p data-slot="tool-diff-summary">
                    +{change().additions} -{change().deletions}
                  </p>
                  <pre>{change().patch}</pre>
                </div>
              )}
            </Show>
            <Diagnostics diagnostics={diagnostics()} />
            <ToolFiles tool={props.part} />
          </>
        )}
      </Show>
      <Show when={!input()}>
        <GenericTool {...props} />
      </Show>
    </Card>
  )
}

function Diagnostics(props: { readonly diagnostics: readonly Diagnostic[] }) {
  const session = useSession()
  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-slot="tool-diagnostics" role="list" aria-label={session.labels().toolFailed}>
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="tool-diagnostic" role="listitem">
              <strong>{session.labels().toolFailed}</strong> [{diagnostic.line}:{diagnostic.character}]{" "}
              {diagnostic.message}
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

function ToolFiles(props: { readonly tool: AssistantTool }) {
  const files = () =>
    props.tool.state.status === "completed" ? props.tool.state.content.filter((part) => part.type === "file") : []
  return (
    <For each={files()}>
      {(file) => (
        <a data-slot="tool-attachment" href={file.uri} target="_blank" rel="noopener noreferrer">
          {file.name ?? file.uri}
        </a>
      )}
    </For>
  )
}

function SubagentTool(props: ToolProps) {
  const session = useSession()
  const input = () => inputOf(props.part)
  const title = () => stringAt(input(), "description") ?? stringAt(input(), "prompt") ?? session.labels().backgroundWork
  const childID = (): SessionID | undefined => {
    const value = stringAt(metadataOf(props.part), "sessionID")
    return isSessionID(value) ? value : undefined
  }
  const href = () => {
    const id = childID()
    return id ? props.sessionHref?.(id) : undefined
  }
  const open = (event: MouseEvent) => {
    const id = childID()
    if (!id || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    props.openSession?.(id)
  }
  return (
    <Card {...props} title={session.labels().agent} summary={title()}>
      <Show when={href()} fallback={<p>{title()}</p>}>
        {(value) => (
          <a href={value()} onClick={open}>
            {title()}
          </a>
        )}
      </Show>
      <ToolFailure tool={props.part} />
    </Card>
  )
}

function SkillTool(props: ToolProps) {
  const session = useSession()
  const input = () => inputOf(props.part)
  return (
    <Card
      {...props}
      title={session.labels().skills}
      summary={stringAt(metadataOf(props.part), "name") ?? stringAt(input(), "id") ?? stringAt(input(), "name")}
    />
  )
}

function GenericTool(props: ToolProps) {
  const session = useSession()
  return (
    <Card {...props} title={session.labels().toolCalled} summary={firstText(inputOf(props.part))}>
      <dl data-slot="tool-input">
        <For each={entries(inputOf(props.part))}>
          {([key, value]) => (
            <>
              <dt>{key}</dt>
              <dd>{json(value)}</dd>
            </>
          )}
        </For>
      </dl>
      <Show when={outputOf(props.part)}>{(value) => <pre data-slot="tool-output">{value()}</pre>}</Show>
      <ToolFailure tool={props.part} />
    </Card>
  )
}
function ToolFailure(props: { readonly tool: AssistantTool }) {
  const session = useSession()
  return (
    <Show when={props.tool.state.status === "error" ? props.tool.state.error : undefined}>
      {(error) => (
        <p role="alert" data-slot="tool-error">
          {session.labels().toolFailed}: {error().message}
        </p>
      )}
    </Show>
  )
}
function inputOf(tool: AssistantTool): JsonRecord {
  return tool.state.status === "streaming" ? {} : tool.state.input
}
function metadataOf(tool: AssistantTool): JsonRecord {
  return tool.state.status === "streaming" ? {} : (tool.state.metadata ?? {})
}
function outputOf(tool: AssistantTool) {
  if (tool.state.status !== "completed") return undefined
  const text = tool.state.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  return text || (tool.state.result === undefined ? undefined : json(tool.state.result))
}
function resultOf(tool: AssistantTool): unknown {
  return tool.state.status === "completed" ? tool.state.result : undefined
}
function stringAt(record: JsonRecord, key: string) {
  const value = record[key]
  return typeof value === "string" && value.length ? value : undefined
}
function integerAt(value: unknown, key: string) {
  return isRecord(value) && isCount(value[key]) ? value[key] : undefined
}
function entries(record: JsonRecord): readonly (readonly [string, unknown])[] {
  return Object.entries(record)
}
function firstText(record: JsonRecord) {
  return Object.values(record).find((value): value is string => typeof value === "string" && value.length > 0)
}
function json(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}
function isSessionID(value: unknown): value is SessionID {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}
function validWrite(value: JsonRecord) {
  const path = stringAt(value, "path")
  const content = value.content
  return path && typeof content === "string" ? { path, content } : undefined
}
function validEdit(value: JsonRecord) {
  const path = stringAt(value, "path")
  const oldString = value.oldString
  const newString = value.newString
  return path && typeof oldString === "string" && typeof newString === "string"
    ? { path, oldString, newString, replaceAll: value.replaceAll === true }
    : undefined
}
type FileDiff = {
  readonly path: string
  readonly patch: string
  readonly additions: number
  readonly deletions: number
}
function fileDiff(metadata: JsonRecord): FileDiff | undefined {
  const files = metadata.files
  if (!Array.isArray(files)) return undefined
  for (const file of files) {
    if (!isRecord(file)) continue
    const path = stringAt(file, "file")
    const patch = file.patch
    const additions = file.additions
    const deletions = file.deletions
    if (
      path &&
      typeof patch === "string" &&
      isCount(additions) &&
      isCount(deletions) &&
      (file.status === "added" || file.status === "deleted" || file.status === "modified")
    )
      return { path, patch, additions, deletions }
  }
  return undefined
}
type Diagnostic = { readonly message: string; readonly line: number; readonly character: number }
function diagnosticsFor(metadata: JsonRecord, path: string | undefined): readonly Diagnostic[] {
  if (!path || !isRecord(metadata.diagnostics)) return []
  const entries = metadata.diagnostics[path]
  if (!Array.isArray(entries)) return []
  const result: Diagnostic[] = []
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      entry.severity !== 1 ||
      typeof entry.message !== "string" ||
      !isRecord(entry.range) ||
      !isRecord(entry.range.start)
    )
      continue
    const line = entry.range.start.line
    const character = entry.range.start.character
    if (isCount(line) && isCount(character))
      result.push({ message: entry.message, line: line + 1, character: character + 1 })
    if (result.length === 3) break
  }
  return result
}

import "./tool-display.css"
