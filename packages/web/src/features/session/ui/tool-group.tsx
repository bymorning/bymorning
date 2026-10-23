import { createEffect, createMemo, createSignal, For, on, onMount, Show, type JSX } from "solid-js"

import { Accordion } from "../../../ui/components/accordion"
import { FileIcon } from "../../../ui/components/file-icon"
import { TextShimmer } from "../../../ui/components/text-shimmer"
import { useI18n, type BmUiI18n } from "../../../ui/context/i18n"
import { BasicTool } from "./basic-tool"
import type { SessionUI } from "./session-model"
import { ToolStatusTitle } from "./tool-status-title"
import { ToolIcon } from "./tools/tool-icon"
import "./tool-group.css"

export function ContextToolGroup(props: {
  readonly entries: ReadonlyArray<SessionUI.TimelinePartEntry>
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const tools = () =>
    props.entries.flatMap((entry) =>
      entry.part.type === "tool" ? [{ key: `${entry.messageID}:${entry.part.id}`, value: entry.part }] : [],
    )
  const toolKeys = createMemo(() => tools().map((tool) => tool.key))
  const pending = () => tools().some((tool) => tool.value.state.type === "running")
  const counts = createMemo(() => ({
    read: tools().filter((tool) => tool.value.name === "read").length,
    search: tools().filter((tool) => tool.value.name === "glob" || tool.value.name === "grep").length,
    list: tools().filter((tool) => tool.value.name === "list").length,
  }))
  const summary = () =>
    [
      counts().read
        ? `${counts().read} ${i18n.t(counts().read === 1 ? "ui.tool.readSummary" : "ui.tool.reads")}`
        : undefined,
      counts().search
        ? `${counts().search} ${i18n.t(counts().search === 1 ? "ui.tool.search" : "ui.tool.searches")}`
        : undefined,
      counts().list
        ? `${counts().list} ${i18n.t(counts().list === 1 ? "ui.tool.listSummary" : "ui.tool.lists")}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <div
      data-timeline-part-ids={tools()
        .map((tool) => tool.value.id)
        .join(",")}
    >
      <BasicTool
        tool="glob"
        status={pending() ? "running" : "succeeded"}
        compact
        rail={false}
        allowOpenWhilePending
        title={i18n.t(pending() ? "ui.tool.exploring" : "ui.tool.explored")}
        {...(props.open === undefined ? {} : { open: props.open })}
        {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
        {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
        trigger={
          <div data-component="context-tool-group-trigger">
            <span data-slot="context-tool-group-title">
              <span data-slot="basic-tool-tool-title">
                <ToolStatusTitle
                  active={pending()}
                  activeText={i18n.t("ui.tool.exploring")}
                  doneText={i18n.t("ui.tool.explored")}
                />
              </span>
              <span data-slot="basic-tool-tool-subtitle">{summary()}</span>
            </span>
          </div>
        }
      >
        <div data-component="context-tool-group-list">
          <For each={toolKeys()}>
            {(key) => {
              const initial = tools().find((tool) => tool.key === key)?.value
              if (!initial) return
              const tool = createMemo(() => tools().find((candidate) => candidate.key === key)?.value ?? initial)
              const info = () => contextToolInfo(tool(), i18n)
              return (
                <div data-slot="context-tool-group-item">
                  <div data-component="tool-trigger" data-status={tool().state.type}>
                    <div data-slot="basic-tool-tool-trigger-content">
                      <ToolIcon name={tool().name} />
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">
                              <TextShimmer text={info().title} active={tool().state.type === "running"} />
                            </span>
                            <Show when={info().subtitle}>
                              {(value) => <bdi data-slot="basic-tool-tool-subtitle">{value()}</bdi>}
                            </Show>
                            <For each={info().args}>{(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}</For>
                          </div>
                          <Show when={info().matches}>
                            {(value) => (
                              <>
                                <span data-slot="context-tool-group-dot" aria-hidden="true" />
                                <span data-slot="context-tool-group-matches">{value()}</span>
                              </>
                            )}
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </BasicTool>
    </div>
  )
}

export function FileToolGroup(props: {
  readonly entries: ReadonlyArray<SessionUI.TimelinePartEntry>
  readonly fileOpen?: (path: string) => boolean | undefined
  readonly onFileOpenChange?: (path: string, open: boolean) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const tools = () => props.entries.flatMap((entry) => (entry.part.type === "tool" ? [entry.part] : []))
  const files = createMemo((previous: ReadonlyArray<ToolFile> | undefined) => {
    const next = props.entries.flatMap((entry) =>
      entry.part.type === "tool"
        ? toolFiles(entry.part).map((file, index) => ({
            ...file,
            key: `${entry.messageID}:${entry.part.id}:${index}`,
          }))
        : [],
    )
    return next.map((file) => {
      const existing = previous?.find((candidate) => candidate.key === file.key)
      return existing && fileEqual(existing, file) ? existing : file
    })
  })
  createEffect(
    on(
      () =>
        files()
          .map((file) => `${file.path}:${file.patch}:${file.additions}:${file.deletions}`)
          .join("|"),
      () => queueMicrotask(() => props.onContentRendered?.()),
    ),
  )
  onMount(() => queueMicrotask(() => props.onContentRendered?.()))
  const [localOpen, setLocalOpen] = createSignal<string[]>([])
  const values = () =>
    props.fileOpen ? files().flatMap((file) => (props.fileOpen?.(file.path) === true ? [file.path] : [])) : localOpen()
  createEffect(
    on(
      () => values().join("|"),
      () => queueMicrotask(() => props.onContentRendered?.()),
    ),
  )
  const change = (value: string | string[]) => {
    const next = Array.isArray(value) ? value : value ? [value] : []
    if (!props.onFileOpenChange) setLocalOpen(next)
    files().forEach((file) => props.onFileOpenChange?.(file.path, next.includes(file.path)))
  }
  const title = () => i18n.t(tools()[0]?.name === "edit" ? "ui.tool.edit" : "ui.tool.applyPatch")
  return (
    <div
      data-component="tool-part-wrapper"
      data-timeline-part-id={tools().length === 1 ? tools()[0]?.id : undefined}
      data-timeline-part-ids={
        tools().length > 1
          ? tools()
              .map((tool) => tool.id)
              .join(",")
          : undefined
      }
    >
      <div data-component="apply-patch-tool">
        <BasicTool
          tool="edit"
          title={title()}
          status={tools().some((tool) => tool.state.type === "running") ? "running" : "succeeded"}
          {...(files().length
            ? { summary: `${files().length} ${i18n.t(files().length === 1 ? "ui.tool.file" : "ui.tool.files")}` }
            : {})}
          rail={false}
          locked
        >
          <Show when={files().length > 0}>
            <Accordion multiple value={values()} onChange={change} data-scope="apply-patch">
              <For each={files()}>
                {(file) => (
                  <Accordion.Item value={file.path} data-type={file.status}>
                    <Accordion.Header>
                      <Accordion.Trigger
                        aria-label={`${file.path}, ${file.additions} ${i18n.t("ui.tool.additions")}, ${file.deletions} ${i18n.t("ui.tool.deletions")}`}
                      >
                        <div data-slot="apply-patch-trigger-content">
                          <div data-slot="apply-patch-file-info">
                            <FileIcon node={{ path: file.path, type: "file" }} />
                            <div data-slot="apply-patch-file-name-container">
                              <Show when={directory(file.path)}>
                                {(value) => <span data-slot="apply-patch-directory">{`\u202A${value()}\u202C`}</span>}
                              </Show>
                              <span data-slot="apply-patch-filename">{filename(file.path)}</span>
                            </div>
                          </div>
                          <div data-slot="apply-patch-trigger-actions">
                            <Show
                              when={file.status === "added"}
                              fallback={
                                <span>
                                  +{file.additions} −{file.deletions}
                                </span>
                              }
                            >
                              <span data-slot="apply-patch-change" data-type="added">
                                {i18n.t("ui.tool.created")}
                              </span>
                            </Show>
                          </div>
                        </div>
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content>
                      <pre
                        data-component="apply-patch-file-diff"
                        role="region"
                        aria-label={`${i18n.t("ui.tool.diffFor")} ${file.path}`}
                      >
                        {file.patch}
                      </pre>
                    </Accordion.Content>
                  </Accordion.Item>
                )}
              </For>
            </Accordion>
          </Show>
        </BasicTool>
      </div>
    </div>
  )
}

function contextToolInfo(tool: SessionUI.ToolPart, i18n: BmUiI18n) {
  const path = typeof tool.input.path === "string" ? tool.input.path : "/"
  const pattern = typeof tool.input.pattern === "string" ? tool.input.pattern : undefined
  const include = typeof tool.input.include === "string" ? tool.input.include : undefined
  const count = tool.name === "glob" ? tool.metadata.count : tool.name === "grep" ? tool.metadata.matches : undefined
  const matches =
    typeof count === "number" && Number.isFinite(count) && count !== 0
      ? `(${count} match${count === 1 ? "" : "es"})`
      : undefined
  if (tool.name === "read")
    return {
      title: i18n.t("ui.tool.read"),
      subtitle: filename(path),
      args: [
        ...(typeof tool.input.offset === "number" ? [`offset=${tool.input.offset}`] : []),
        ...(typeof tool.input.limit === "number" ? [`limit=${tool.input.limit}`] : []),
      ],
      matches,
    }
  if (tool.name === "list")
    return { title: i18n.t("ui.tool.list"), subtitle: directory(path) || "/", args: [], matches }
  return {
    title: i18n.t(tool.name === "glob" ? "ui.tool.glob" : "ui.tool.grep"),
    subtitle: directory(path) || "/",
    args: [...(pattern ? [`pattern=${pattern}`] : []), ...(include ? [`include=${include}`] : [])],
    matches,
  }
}

function toolFiles(tool: SessionUI.ToolPart) {
  const files = tool.metadata.files
  if (!Array.isArray(files)) return []
  return files.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []
    const file = Reflect.get(value, "file")
    const patch = Reflect.get(value, "patch")
    const additions = Reflect.get(value, "additions")
    const deletions = Reflect.get(value, "deletions")
    const status = Reflect.get(value, "status")
    if (typeof file !== "string" || !file || typeof patch !== "string") return []
    if (typeof additions !== "number" || typeof deletions !== "number") return []
    if (status !== "added" && status !== "deleted" && status !== "modified") return []
    return [{ path: file, patch, additions, deletions, status }]
  })
}

type ToolFile = ReturnType<typeof toolFiles>[number] & { readonly key: string }

function fileEqual(left: ToolFile, right: ToolFile) {
  return (
    left.path === right.path &&
    left.patch === right.patch &&
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.status === right.status
  )
}

function filename(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path
}

function directory(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index < 0 ? "" : path.slice(0, index + 1)
}
