import { createMemo, createUniqueId, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useI18n } from "../../../ui/context/i18n"
import { CopyAction, MessageAction } from "./message-action"
import { ProjectFileReference } from "./project-file-reference"
import type { SessionUI } from "./session-model"
import "./user-message.css"

export function UserMessage(props: {
  readonly message: SessionUI.UserMessage
  readonly projectFiles: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly open?: boolean
  readonly onOpen?: (open: boolean) => void
  readonly onResize?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const contentID = createUniqueId()
  const [view, setView] = createStore({ expanded: false })
  const text = createMemo(() => props.message.text)
  const collapsible = createMemo(() => isCollapsible(text()))
  const expanded = () => collapsible() && (props.open ?? view.expanded)
  const toggle = () => {
    if (!collapsible()) return
    const next = !expanded()
    if (props.onOpen) props.onOpen(next)
    else setView("expanded", next)
    queueMicrotask(() => props.onResize?.())
  }
  return (
    <div
      data-component="user-message"
      data-role="user"
      data-timeline-part-id={props.message.text ? `${props.message.id}:text:0` : undefined}
    >
      <div
        data-slot="user-message-body"
        data-collapsible={collapsible() ? "" : undefined}
        data-expanded={expanded() ? "" : undefined}
        onClick={(event) => {
          if (!collapsible() || (event.target instanceof Element && event.target.closest("button"))) return
          const selection = window.getSelection()
          if (selection?.toString() && selection.anchorNode && event.currentTarget.contains(selection.anchorNode))
            return
          toggle()
        }}
      >
        <div id={contentID} data-slot="user-message-text" dir="auto">
          <ProjectFileReference.Text
            value={props.message.text}
            paths={props.projectFiles}
            skills={props.skills ?? []}
            agents={props.message.agents ?? []}
          />
        </div>
        <Show when={collapsible()}>
          <button
            type="button"
            data-slot="user-message-toggle"
            aria-controls={contentID}
            aria-expanded={expanded()}
            onClick={toggle}
          >
            {i18n.t(expanded() ? "ui.message.showLess" : "ui.message.showMore")}
          </button>
        </Show>
      </div>
      <Show when={text()}>
        <MessageAction owner="user">
          <CopyAction text={text()} label={i18n.t("ui.message.copyMessage")} />
        </MessageAction>
      </Show>
    </div>
  )
}

function isCollapsible(text: string) {
  return text.length > 420 || text.split("\n").length > 6
}
