import { createMemo, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"

import { useI18n } from "../../../ui/context/i18n"
import { projectTimeline } from "../timeline/projection"
import { TimelineRow } from "../timeline/timeline-row"
import type { TimelineInteraction } from "../timeline/interaction"
import { TimelineVirtualizer } from "../timeline/virtualizer"
import type { TimelineDisclosure } from "../timeline/virtualizer"
import type { SessionUI } from "./session-model"
import "./message-timeline.css"

type MessageTimelineProps = {
  readonly sessionKey?: string
  readonly interaction?: TimelineInteraction
  readonly header?: JSX.Element
  readonly footer?: JSX.Element
  readonly projectFiles: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly agents?: ReadonlyArray<SessionUI.AgentPresentation>
  readonly subagentNavigation?: SessionUI.SubagentNavigation
  readonly preferences: SessionUI.Preferences
  readonly renderMarkdown?: boolean
  readonly onFileOpen: (path: string) => void
  readonly actions?: Omit<SessionUI.TimelineActions, "openFile">
} & (
  | { readonly items: ReadonlyArray<SessionUI.Item>; readonly projection?: never }
  | { readonly projection: SessionUI.TimelineProjection; readonly items?: never }
)

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const i18n = useI18n()
  const projection = createMemo(
    (previous: SessionUI.TimelineProjection | undefined) =>
      props.projection ?? projectTimeline(props.items, props.preferences, previous?.rows),
  )
  const virtual = createMemo(() => {
    if (!props.interaction || !props.sessionKey) return
    return { interaction: props.interaction, sessionKey: props.sessionKey }
  })

  return (
    <Show when={virtual()} keyed fallback={<PlainTimeline {...props} projection={projection} />}>
      {(options) => (
        <section data-component="message-timeline" data-virtual aria-label={i18n.t("ui.message")}>
          <TimelineVirtualizer
            sessionKey={options.sessionKey}
            rows={projection().rows}
            rowByKey={projection().rowByKey}
            messageFirstRowIndex={projection().messageFirstRowIndex}
            {...(projection().activeLastRowKey ? { activeLastRowKey: projection().activeLastRowKey } : {})}
            interaction={options.interaction}
            {...(props.header === undefined ? {} : { header: props.header })}
            {...(props.footer === undefined ? {} : { footer: props.footer })}
            renderRow={(row, onSizeChange, disclosure: TimelineDisclosure) => (
              <TimelineRow
                row={row}
                projection={projection}
                projectFiles={props.projectFiles}
                skills={props.skills ?? []}
                agents={props.agents ?? []}
                {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
                onFileOpen={props.onFileOpen}
                {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
                {...(props.actions === undefined ? {} : { actions: props.actions })}
                disclosure={disclosure}
                onSizeChange={onSizeChange}
              />
            )}
          />
        </section>
      )}
    </Show>
  )
}

function PlainTimeline(props: {
  readonly projection: Accessor<SessionUI.TimelineProjection>
  readonly projectFiles: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly agents?: ReadonlyArray<SessionUI.AgentPresentation>
  readonly subagentNavigation?: SessionUI.SubagentNavigation
  readonly onFileOpen: (path: string) => void
  readonly renderMarkdown?: boolean
  readonly actions?: Omit<SessionUI.TimelineActions, "openFile">
  readonly header?: JSX.Element
  readonly footer?: JSX.Element
}): JSX.Element {
  const i18n = useI18n()
  let timeline!: HTMLElement
  const rowKeys = createMemo(() => props.projection().rows.map((row) => row.key))

  function Row(rowProps: { readonly rowKey: string }) {
    const initial = props.projection().rowByKey.get(rowProps.rowKey)
    if (!initial) return
    const row = createMemo(() => props.projection().rowByKey.get(rowProps.rowKey) ?? initial)
    return (
      <TimelineRow
        row={row}
        projection={props.projection}
        projectFiles={props.projectFiles}
        skills={props.skills ?? []}
        agents={props.agents ?? []}
        {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
        onFileOpen={props.onFileOpen}
        {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
        {...(props.actions === undefined ? {} : { actions: props.actions })}
      />
    )
  }

  onMount(() => {
    const scroll = timeline.parentElement!
    let stickToBottom = true
    const handleScroll = () => {
      stickToBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 24
    }
    const observer = new MutationObserver(() => {
      if (stickToBottom) scroll.scrollTop = scroll.scrollHeight
    })

    scroll.addEventListener("scroll", handleScroll, { passive: true })
    observer.observe(timeline, { childList: true, characterData: true, subtree: true })
    scroll.scrollTop = scroll.scrollHeight

    onCleanup(() => {
      scroll.removeEventListener("scroll", handleScroll)
      observer.disconnect()
    })
  })

  return (
    <section
      ref={(element) => (timeline = element)}
      data-component="message-timeline"
      aria-label={i18n.t("ui.message")}
    >
      <div data-slot="message-timeline-scroll">
        {props.header}
        <div data-slot="message-timeline-content">
          <Show
            when={rowKeys().length > 0}
            fallback={<p data-slot="message-timeline-empty">{i18n.t("ui.message.empty")}</p>}
          >
            <ol data-slot="message-timeline-turns">
              <For each={rowKeys()}>
                {(rowKey) => (
                  <li data-timeline-key={rowKey}>
                    <Row rowKey={rowKey} />
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
        <Show when={props.footer !== undefined}>
          <div data-slot="timeline-bottom-footer">{props.footer}</div>
        </Show>
      </div>
    </section>
  )
}
