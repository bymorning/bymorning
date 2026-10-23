import { Match, Show, Switch, type JSX } from "solid-js"

import { useI18n } from "../../../ui/context/i18n"
import { CopyAction, MessageAction } from "./message-action"
import { ToolDisplay } from "./tools/tool-display"
import { PacedMarkdown } from "./paced-markdown"
import type { SessionUI } from "./session-model"
import type { TimelineDisclosure } from "../timeline/virtualizer"
import "./message-part.css"

export function MessagePart(props: {
  readonly part: SessionUI.MessagePart
  readonly streaming: boolean
  readonly renderMarkdown?: boolean
  readonly onFileOpen: (path: string) => void
  readonly agents?: ReadonlyArray<SessionUI.AgentPresentation>
  readonly subagentNavigation?: SessionUI.SubagentNavigation
  readonly actions?: Omit<SessionUI.TimelineActions, "openFile">
  readonly cacheKey?: string
  readonly disclosureKey?: string
  readonly disclosure?: TimelineDisclosure
  readonly onContentRendered?: () => void
  readonly copyText?: string
  readonly details?: string
  readonly interrupted?: boolean
}): JSX.Element {
  const i18n = useI18n()
  const footerMeta = () =>
    [props.details, props.interrupted ? i18n.t("ui.message.interrupted") : undefined].filter(Boolean).join(" · ")
  const text = () => {
    const part = props.part
    return part.type === "text" || part.type === "reasoning" ? part : undefined
  }
  const tool = () => {
    const part = props.part
    return part.type === "tool" ? part : undefined
  }
  const changeToolOpen = (open: boolean) => {
    if (!props.disclosureKey) return
    props.disclosure?.set(props.disclosureKey, open)
  }
  return (
    <Switch>
      <Match when={text()}>
        {(part) => (
          <div
            data-component={part().type === "text" ? "text-part" : "reasoning-part"}
            data-timeline-part-id={part().id}
          >
            <div data-slot={part().type === "text" ? "text-part-body" : undefined}>
              <PacedMarkdown
                text={part().text}
                cacheKey={props.cacheKey ?? part().id}
                streaming={props.streaming}
                {...(props.renderMarkdown === undefined ? {} : { renderMarkdown: props.renderMarkdown })}
                {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
              />
            </div>
            <Show when={part().type === "text" && (props.copyText || props.details || props.interrupted)}>
              <MessageAction owner="assistant" {...(props.interrupted ? { interrupted: true } : {})}>
                <Show when={props.copyText}>
                  {(value) => <CopyAction text={value()} label={i18n.t("ui.message.copyResponse")} />}
                </Show>
                <Show when={footerMeta()}>{(value) => <span data-slot="text-part-meta">{value()}</span>}</Show>
              </MessageAction>
            </Show>
          </div>
        )}
      </Match>
      <Match when={tool()}>
        {(part) => (
          <div data-component="message-part" data-type="tool">
            <ToolDisplay
              tool={part()}
              onFileOpen={props.onFileOpen}
              agents={props.agents ?? []}
              {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
              actions={{
                sessionHref: props.actions?.sessionHref ?? (() => undefined),
                openSession: props.actions?.openSession ?? (() => undefined),
                sessionStatus: props.actions?.sessionStatus ?? (() => "idle"),
              }}
              {...(props.disclosureKey && props.disclosure?.value(props.disclosureKey) !== undefined
                ? { open: props.disclosure.value(props.disclosureKey)! }
                : {})}
              {...(props.disclosureKey && props.disclosure ? { onOpenChange: changeToolOpen } : {})}
              {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
            />
          </div>
        )}
      </Match>
    </Switch>
  )
}
