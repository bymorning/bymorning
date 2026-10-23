import { createEffect, createMemo, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createVirtualizer } from "@tanstack/solid-virtual"

import { useSession } from "../context/session"
import type { SessionUI } from "../model"
import { MessageView } from "../message/message"

type Row = SessionUI.Row

export function SessionTimeline(props: SessionUI.Timeline): JSX.Element {
  return (
    <Show keyed when={props.sessionID()}>
      <SessionTimelineView {...props} />
    </Show>
  )
}

/** A session identity owns every DOM measurement and scroll observer. */
function SessionTimelineView(props: SessionUI.Timeline): JSX.Element {
  const session = useSession()
  let root: HTMLElement | undefined
  let pinned = true
  const keys = createMemo(() => props.rows().map((row) => row.key))
  const virtualizer = createVirtualizer<HTMLElement, HTMLLIElement>({
    get count() {
      return props.virtual ? props.rows().length : 0
    },
    getScrollElement: () => root ?? null,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => props.rows()[index]?.key ?? index,
  })
  const follow = () => {
    if (pinned && root) root.scrollTop = root.scrollHeight
  }

  onMount(() => {
    const element = root
    if (!element) return
    const scroll = () => {
      pinned = element.scrollHeight - element.clientHeight - element.scrollTop < 24
    }
    const observer = new MutationObserver(follow)
    element.addEventListener("scroll", scroll, { passive: true })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
    follow()
    onCleanup(() => {
      element.removeEventListener("scroll", scroll)
      observer.disconnect()
    })
  })
  createEffect(() => {
    props.sessionID()
    keys()
    follow()
  })

  const row = (value: Row) => (
    <TimelineRow
      row={value}
      reasoning={props.reasoning?.()}
      onFileOpen={props.onFileOpen}
      openSession={props.openSession}
      sessionHref={props.sessionHref}
      submission={props.submission}
    />
  )
  return (
    <section
      ref={(element) => {
        root = element
      }}
      data-component="session-timeline"
      data-session-id={props.sessionID()}
      data-virtual={props.virtual ? "true" : undefined}
      aria-label={session.labels().timeline}
      tabIndex={0}
    >
      <Show when={props.history?.more()}>
        <button type="button" data-slot="timeline-history" onClick={() => props.history?.load.run()}>
          {session.labels().loadEarlier}
        </button>
      </Show>
      <Show when={props.loading()}>
        <p role="status" data-slot="timeline-loading">
          {session.labels().loading}
        </p>
      </Show>
      <Show when={props.error()}>
        {(error) => (
          <section role="alert" data-slot="timeline-error">
            <p>{error()}</p>
            <Show when={props.reload}>
              <button type="button" onClick={() => props.reload?.run()}>
                {session.labels().retry}
              </button>
            </Show>
          </section>
        )}
      </Show>
      <Show when={!props.loading() && !props.error() && keys().length === 0}>
        <p data-slot="timeline-empty">{session.labels().emptyMessage}</p>
      </Show>
      <Show
        when={props.virtual}
        fallback={
          <ol data-slot="timeline-rows">
            <For each={props.rows()}>{(value) => <li data-timeline-key={value.key}>{row(value)}</li>}</For>
          </ol>
        }
      >
        <ol
          data-slot="timeline-rows"
          data-virtual-list
          style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(item) => {
              const value = () => props.rows()[item.index]
              return (
                <Show when={value()}>
                  {(current) => (
                    <li
                      ref={virtualizer.measureElement}
                      data-timeline-key={current().key}
                      data-index={item.index}
                      tabIndex={-1}
                      style={{
                        position: "absolute",
                        top: "0",
                        left: "0",
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      {row(current())}
                    </li>
                  )}
                </Show>
              )
            }}
          </For>
        </ol>
      </Show>
    </section>
  )
}

function TimelineRow(props: {
  readonly row: Row
  readonly reasoning?: boolean | undefined
  readonly onFileOpen?: ((path: string) => void) | undefined
  readonly openSession?: SessionUI.ToolProps["openSession"]
  readonly sessionHref?: SessionUI.ToolProps["sessionHref"]
  readonly submission?: SessionUI.Timeline["submission"]
}) {
  if (props.row.type === "message")
    return (
      <MessageView
        message={props.row.message}
        reasoning={props.reasoning}
        onFileOpen={props.onFileOpen}
        openSession={props.openSession}
        sessionHref={props.sessionHref}
      />
    )
  if (props.row.type === "inbox") return <InboxRow item={props.row.item} />
  return <SubmissionRow submission={props.row.submission} actions={props.submission} />
}

function InboxRow(props: { readonly item: import("@bymorning/client/solid").InboxItem }) {
  const text = () => ("text" in props.item.payload ? props.item.payload.text : undefined)
  return (
    <article data-component="inbox-message">
      <Show when={text()}>{(value) => <p>{value()}</p>}</Show>
    </article>
  )
}

function SubmissionRow(props: {
  readonly submission: import("@bymorning/client/solid").Submission
  readonly actions?: SessionUI.Timeline["submission"]
}) {
  const session = useSession()
  const retry = () => props.actions?.retry(props.submission)
  const error = () => (props.submission.state.state === "sending" ? undefined : props.submission.state.error)
  return (
    <article data-component="pending-submission" data-state={props.submission.state.state}>
      <Show when={error()}>
        {(value) => (
          <>
            <p role="alert">{errorText(value(), session.labels().toolFailed)}</p>
            <Show when={retry()}>
              {(action) => (
                <button type="button" disabled={action().pending()} onClick={() => action().run()}>
                  {session.labels().retry}
                </button>
              )}
            </Show>
            <Show when={props.actions}>
              <button type="button" onClick={() => props.actions?.dismiss(props.submission)}>
                {session.labels().dismiss}
              </button>
            </Show>
          </>
        )}
      </Show>
    </article>
  )
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : fallback
}

import "./session-timeline.css"
