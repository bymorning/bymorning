import { Match, Show, Switch, type JSX } from "solid-js"

import type { SessionUI } from "./session-model"
import { PacedMarkdown } from "./paced-markdown"
import "./session-notice.css"

function CompactionNotice(props: {
  readonly notice: SessionUI.Notice
  readonly renderMarkdown?: boolean
}): JSX.Element {
  const summary = () => props.notice.summary?.trim()
  const recent = () => props.notice.recent?.trim()
  return (
    <div
      data-slot="session-compaction"
      data-status={props.notice.status}
      role={props.notice.status === "failed" ? "alert" : "status"}
      aria-atomic="true"
    >
      <div data-slot="session-compaction-header">
        <span data-slot="session-compaction-indicator" aria-hidden="true" />
        <div data-slot="session-compaction-copy">
          <p data-slot="session-notice-text">{props.notice.text}</p>
          <Show when={props.notice.detail}>
            <p data-slot="session-notice-description">{props.notice.detail}</p>
          </Show>
        </div>
        <Show when={props.notice.reason}>
          {(reason) => (
            <span data-slot="session-compaction-reason">{reason() === "auto" ? "Automatic" : "Manual"}</span>
          )}
        </Show>
      </div>
      <Show when={summary()}>
        {(checkpoint) => (
          <details data-slot="session-compaction-details">
            <summary>View context checkpoint</summary>
            <div data-slot="session-compaction-content">
              <p data-slot="session-compaction-label">Summary</p>
              <PacedMarkdown
                text={checkpoint()}
                cacheKey={`compaction:${props.notice.id}:summary`}
                streaming={false}
                {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
              />
              <Show when={recent()}>
                {(value) => (
                  <>
                    <p data-slot="session-compaction-label">Recent context kept verbatim</p>
                    <pre data-slot="session-compaction-recent">{value()}</pre>
                  </>
                )}
              </Show>
            </div>
          </details>
        )}
      </Show>
    </div>
  )
}

export function SessionNotice(props: {
  readonly notice: SessionUI.Notice
  readonly renderMarkdown?: boolean
}): JSX.Element {
  return (
    <div
      data-component="session-notice"
      data-slot="session-timeline-notice"
      data-kind={props.notice.kind}
      data-effect={props.notice.effect}
      data-action={props.notice.action}
      data-resource={props.notice.resource}
      data-policy={props.notice.policy}
      data-rule={props.notice.rule}
      data-message={props.notice.id}
      role={props.notice.kind === "policy" ? "status" : undefined}
    >
      <Switch>
        <Match when={props.notice.kind === "selection"}>
          <span data-slot="session-notice-separator" aria-hidden="true" />
          <span data-slot="session-notice-label">
            <span data-slot="session-notice-text">{props.notice.text}</span>
          </span>
          <span data-slot="session-notice-separator" aria-hidden="true" />
        </Match>
        <Match when={props.notice.kind === "compaction"}>
          <CompactionNotice
            notice={props.notice}
            {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
          />
        </Match>
        <Match when={props.notice.kind === "policy"}>
          <div data-slot="session-notice-copy">
            <p data-slot="session-notice-text">{props.notice.text}</p>
            <Show when={props.notice.detail}>
              <p data-slot="session-notice-description">{props.notice.detail}</p>
            </Show>
          </div>
        </Match>
        <Match when={true}>
          <p data-slot="session-notice-text">{props.notice.text}</p>
        </Match>
      </Switch>
    </div>
  )
}
