import { createMemo, Match, Switch, type JSX } from "solid-js"

import { MessageTimeline } from "./message-timeline"
import type { TimelineInteraction } from "../timeline/interaction"
import type { SessionUI } from "./session-model"
import "./session-timeline.css"

export function SessionTimeline(props: {
  readonly model: SessionUI.Timeline
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
}): JSX.Element {
  const failure = () => (props.model.state === "failed" ? props.model.message : undefined)
  // The ready projection is retained across loading and failed states. A narrowing
  // <Match> callback accessor throws a stale read when a dependent (the virtualizer's
  // rows) is evaluated in the same update that moved the model away from ready, so
  // the branch condition and the projection accessor are kept separate.
  const ready = createMemo<SessionUI.TimelineProjection | undefined>((previous) => {
    const model = props.model
    return model.state === "ready" ? model : previous
  })
  return (
    <div data-component="session-timeline">
      <Switch>
        <Match when={props.model.state === "loading"}>
          <section data-component="message-timeline" data-loading>
            <div data-slot="message-timeline-scroll">{props.header}</div>
          </section>
        </Match>
        <Match when={props.model.state === "failed"}>
          <p data-slot="session-timeline-error" role="alert">
            {failure()}
          </p>
        </Match>
        <Match when={props.model.state === "ready" && ready() !== undefined}>
          <MessageTimeline
            projection={ready()!}
            {...(props.sessionKey === undefined ? {} : { sessionKey: props.sessionKey })}
            {...(props.interaction === undefined ? {} : { interaction: props.interaction })}
            {...(props.header === undefined ? {} : { header: props.header })}
            {...(props.footer === undefined ? {} : { footer: props.footer })}
            projectFiles={props.projectFiles}
            skills={props.skills ?? []}
            agents={props.agents ?? []}
            {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
            preferences={props.preferences}
            {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
            onFileOpen={props.onFileOpen}
            {...(props.actions === undefined ? {} : { actions: props.actions })}
          />
        </Match>
      </Switch>
    </div>
  )
}
