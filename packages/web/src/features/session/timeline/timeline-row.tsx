import { createMemo, For, Match, Switch, type Accessor, type JSX } from "solid-js"

import { TextShimmer } from "../../../ui/components/text-shimmer"
import { useI18n } from "../../../ui/context/i18n"
import { MessagePart } from "../ui/message-part"
import { ExecutionErrorCard } from "../ui/execution-error-card"
import { SessionNotice } from "../ui/session-notice"
import type { SessionUI } from "../ui/session-model"
import { ContextToolGroup, FileToolGroup } from "../ui/tool-group"
import { UserMessage } from "../ui/user-message"
import type { TimelineDisclosure } from "./virtualizer"
import "./session-turn.css"

export const timelinePartKey = (rowKey: string, partID: string) => `${rowKey}:${partID}`

export function TimelineRow(props: {
  readonly row: Accessor<SessionUI.TimelineRow>
  readonly projection: Accessor<SessionUI.TimelineProjection>
  readonly projectFiles: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly agents?: ReadonlyArray<SessionUI.AgentPresentation>
  readonly subagentNavigation?: SessionUI.SubagentNavigation
  readonly onFileOpen: (path: string) => void
  readonly renderMarkdown?: boolean
  readonly actions?: Omit<SessionUI.TimelineActions, "openFile">
  readonly disclosure?: TimelineDisclosure
  readonly onSizeChange?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const gap = createMemo(() => {
    const row = props.row()
    if (row.type === "turn-gap") return row
  })
  const notice = createMemo(() => {
    const row = props.row()
    if (row.type !== "notice") return
    const value = props.projection().noticeByID.get(row.noticeID)
    if (value) return { row, value }
  })
  const user = createMemo(() => {
    const row = props.row()
    if (row.type !== "user-message") return
    const value = props.projection().userByID.get(row.messageID)
    if (value) return { row, value }
  })
  const divider = createMemo(() => {
    const row = props.row()
    if (row.type === "turn-divider") return row
  })
  const error = createMemo(() => {
    const row = props.row()
    if (row.type === "error") return row
  })
  const part = createMemo(() => {
    const row = props.row()
    if (row.type === "assistant-part") return row
  })
  const thinking = createMemo(() => {
    const row = props.row()
    if (row.type === "thinking") return row
  })
  const retry = createMemo(() => {
    const row = props.row()
    if (row.type === "retry") return row
  })
  const entries = (group: SessionUI.TimelinePartGroup) =>
    (group.type === "part" ? [group.ref] : group.refs).flatMap((ref) => {
      const entry = props.projection().resolvePart(ref.messageID, ref.partID)
      return entry ? [entry] : []
    })

  function Frame(frameProps: {
    readonly row: Exclude<SessionUI.TimelineRow, { type: "turn-gap" }>
    children: JSX.Element
  }) {
    return (
      <div
        id={frameProps.row.type === "user-message" ? `message-${frameProps.row.messageID}` : undefined}
        data-message-id={frameProps.row.turnID}
        data-timeline-row={rowTag(frameProps.row)}
        data-previous-assistant-part={
          frameProps.row.type === "assistant-part" && frameProps.row.previousAssistantPart ? "" : undefined
        }
      >
        <div data-component="session-turn">{frameProps.children}</div>
      </div>
    )
  }

  return (
    <Switch>
      <Match when={gap()}>{(_current) => <div data-timeline-row="TurnGap" aria-hidden="true" />}</Match>
      <Match when={notice()}>
        {(current) => (
          <Frame row={current().row}>
            <SessionNotice
              notice={current().value}
              {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
            />
          </Frame>
        )}
      </Match>
      <Match when={user()}>
        {(current) => (
          <Frame row={current().row}>
            <div data-slot="session-turn-message-container">
              <div data-slot="session-turn-message-content" aria-live="off">
                <UserMessage
                  message={current().value}
                  projectFiles={props.projectFiles}
                  skills={props.skills ?? []}
                  {...(props.disclosure
                    ? {
                        open: props.disclosure.value(`user-message:${current().row.messageID}`) === true,
                        onOpen: (open: boolean) =>
                          props.disclosure?.set(`user-message:${current().row.messageID}`, open),
                      }
                    : {})}
                  {...(props.onSizeChange === undefined ? {} : { onResize: props.onSizeChange })}
                />
              </div>
            </div>
          </Frame>
        )}
      </Match>
      <Match when={divider()}>
        {(current) => (
          <Frame row={current()}>
            <div data-slot="session-turn-message-container">
              <div data-slot="session-turn-compaction">
                <div data-slot="session-turn-divider">
                  <span data-slot="session-turn-divider-label">{i18n.t("ui.message.interrupted")}</span>
                </div>
              </div>
            </div>
          </Frame>
        )}
      </Match>
      <Match when={error()}>
        {(current) => (
          <Frame row={current()}>
            <div data-slot="session-turn-message-container">
              <div data-slot="session-turn-execution-status">
                <ExecutionErrorCard failure={current().failure} />
              </div>
            </div>
          </Frame>
        )}
      </Match>
      <Match when={part()}>
        {(current) => {
          const entryByKey = createMemo(
            () => new Map(entries(current().group).map((entry) => [`${entry.messageID}:${entry.part.id}`, entry])),
          )
          const entryKeys = createMemo(() => [...entryByKey().keys()])
          function Part(entryProps: { readonly entryKey: string }) {
            const initial = entryByKey().get(entryProps.entryKey)
            if (!initial) return
            const entry = createMemo(() => entryByKey().get(entryProps.entryKey) ?? initial)
            return (
              <MessagePart
                part={entry().part}
                streaming={entry().streaming}
                onFileOpen={props.onFileOpen}
                {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
                agents={props.agents ?? []}
                {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
                actions={{
                  sessionHref: props.actions?.sessionHref ?? (() => undefined),
                  openSession: props.actions?.openSession ?? (() => undefined),
                  sessionStatus: props.actions?.sessionStatus ?? (() => "idle"),
                }}
                cacheKey={`${entry().messageID}:${entry().part.id}`}
                disclosureKey={`${timelinePartKey(current().key, entry().part.id)}:tool`}
                {...(entry().copyText === undefined ? {} : { copyText: entry().copyText })}
                {...(entry().details === undefined ? {} : { details: entry().details })}
                {...(entry().interrupted === undefined ? {} : { interrupted: entry().interrupted })}
                {...(props.disclosure === undefined ? {} : { disclosure: props.disclosure })}
                {...(props.onSizeChange === undefined ? {} : { onContentRendered: props.onSizeChange })}
              />
            )
          }
          return (
            <Frame row={current()}>
              <div data-slot="session-turn-message-container">
                <div
                  data-slot="session-turn-assistant-content"
                  data-group={current().group.type}
                  aria-hidden={entries(current().group).some((entry) => entry.streaming)}
                >
                  <Switch>
                    <Match when={current().group.type === "context"}>
                      <ContextToolGroup
                        entries={entries(current().group)}
                        {...(props.disclosure
                          ? {
                              open: props.disclosure.value(`context:${current().group.key}`) === true,
                              onOpenChange: (open: boolean) =>
                                props.disclosure?.set(`context:${current().group.key}`, open),
                            }
                          : {})}
                        {...(props.onSizeChange === undefined ? {} : { onContentRendered: props.onSizeChange })}
                      />
                    </Match>
                    <Match when={current().group.type === "file"}>
                      <FileToolGroup
                        entries={entries(current().group)}
                        {...(props.disclosure
                          ? {
                              fileOpen: (path: string) =>
                                props.disclosure?.value(`${current().group.key}:file:${path}`),
                              onFileOpenChange: (path: string, open: boolean) =>
                                props.disclosure?.set(`${current().group.key}:file:${path}`, open),
                            }
                          : {})}
                        {...(props.onSizeChange === undefined ? {} : { onContentRendered: props.onSizeChange })}
                      />
                    </Match>
                    <Match when={true}>
                      <For each={entryKeys()}>{(entryKey) => <Part entryKey={entryKey} />}</For>
                    </Match>
                  </Switch>
                </div>
              </div>
            </Frame>
          )
        }}
      </Match>
      <Match when={thinking()}>
        {(current) => (
          <Frame row={current()}>
            <div data-slot="session-turn-message-container">
              <div data-slot="session-turn-thinking-row">
                <div data-slot="session-turn-thinking" role="status" aria-label={i18n.t("ui.tool.thinking")}>
                  <TextShimmer text={i18n.t("ui.tool.thinking")} />
                </div>
              </div>
            </div>
          </Frame>
        )}
      </Match>
      <Match when={retry()}>
        {(current) => {
          const scheduled = () =>
            new Intl.DateTimeFormat(i18n.locale(), {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }).format(current().at)
          return (
            <Frame row={current()}>
              <div data-slot="session-turn-message-container">
                <div data-slot="session-turn-retry-row">
                  <div data-slot="session-turn-retry" role="status">
                    {i18n.t("ui.session.retryScheduled", { attempt: current().attempt, scheduled: scheduled() })}
                  </div>
                </div>
              </div>
            </Frame>
          )
        }}
      </Match>
    </Switch>
  )
}

function rowTag(row: Exclude<SessionUI.TimelineRow, { type: "turn-gap" }>) {
  if (row.type === "user-message") return "UserMessage"
  if (row.type === "assistant-part") return "AssistantPart"
  if (row.type === "notice") return "Notice"
  if (row.type === "turn-divider") return "TurnDivider"
  if (row.type === "thinking") return "Thinking"
  if (row.type === "retry") return "Retry"
  return "Error"
}
