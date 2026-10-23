import { For, Show, type JSX } from "solid-js"

import { Keybind } from "../../../ui/components/keybind"
import { Loader } from "../../../ui/components/loader"
import { useI18n } from "../../../ui/context/i18n"
import type { SessionUI } from "./session-model"
import "./subagent-background.css"

export function BackgroundHint(): JSX.Element {
  const i18n = useI18n()
  const shortcut = () => i18n.t("ui.session.background.keybind")
  return (
    <div
      data-component="background-hint"
      role="status"
      aria-label={i18n.t("ui.session.background.hintLabel", { shortcut: shortcut() })}
    >
      <span>{i18n.t("ui.session.background.hint")}</span>
      <Keybind keys={shortcut().split("+")} variant="ghost" aria-label={shortcut()} />
    </div>
  )
}

export function BackgroundTasks(props: {
  readonly tasks: ReadonlyArray<SessionUI.BackgroundTask>
  readonly sessionHref: (sessionID: string) => string | undefined
  readonly openSession: (sessionID: string) => void
}): JSX.Element {
  const i18n = useI18n()
  const label = () => i18n.t("ui.session.background.summary", { count: props.tasks.length })
  return (
    <details data-component="background-tasks">
      <summary aria-label={label()}>
        <Loader width={14} height={14} />
        <span>{label()}</span>
      </summary>
      <ul aria-label={i18n.t("ui.session.background.heading")}>
        <For each={props.tasks}>
          {(task) => {
            const href = () => (task.sessionID ? props.sessionHref(task.sessionID) : undefined)
            const kind = () =>
              i18n.t(task.kind === "shell" ? "ui.session.background.shell" : "ui.session.background.subagent")
            const title = () => task.title ?? kind()
            const description = () =>
              task.description ??
              i18n.t(
                task.kind === "shell" ? "ui.session.background.shellCommand" : "ui.session.background.delegatedTask",
              )
            const taskLabel = () =>
              i18n.t("ui.session.background.taskLabel", {
                kind: kind(),
                title: title(),
                description: description(),
                status: i18n.t("ui.session.background.working"),
              })
            return (
              <li
                aria-label={taskLabel()}
                style={{ "--background-task-color": task.color ?? "var(--color-text-muted)" }}
              >
                <span data-slot="background-task-kind">{title()}</span>
                <Show
                  when={task.description}
                  fallback={<span data-slot="background-task-description">{description()}</span>}
                >
                  <span aria-hidden="true">·</span>
                  <span data-slot="background-task-description">{task.description}</span>
                </Show>
                <Show when={href()}>
                  {(target) => (
                    <a
                      href={target()}
                      aria-label={i18n.t("ui.session.background.openTask", { title: title() })}
                      onClick={(event) => {
                        if (
                          event.defaultPrevented ||
                          event.button !== 0 ||
                          event.altKey ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.shiftKey
                        )
                          return
                        event.preventDefault()
                        if (task.sessionID) props.openSession(task.sessionID)
                      }}
                    >
                      {i18n.t("ui.session.background.open")}
                    </a>
                  )}
                </Show>
              </li>
            )
          }}
        </For>
      </ul>
    </details>
  )
}
