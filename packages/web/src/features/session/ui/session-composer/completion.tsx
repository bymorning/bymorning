import { Show, type JSX, type ParentProps } from "solid-js"

import "./completion.css"

export function ComposerCompletionPopover(
  props: ParentProps<{
    readonly id: string
    readonly kind: "commands" | "references"
    readonly label: string
    readonly busy?: boolean
    readonly ref?: (element: HTMLDivElement) => void
  }>,
): JSX.Element {
  return (
    <div
      ref={props.ref}
      id={props.id}
      data-component="session-composer-completions"
      data-kind={props.kind}
      role="listbox"
      aria-label={props.label}
      aria-busy={props.busy}
    >
      {props.children}
    </div>
  )
}

export function ComposerCompletionRow(props: {
  readonly id: string
  readonly kind: "agent" | "command" | "file" | "skill"
  readonly active: boolean
  readonly icon: JSX.Element
  readonly label: JSX.Element
  readonly description?: JSX.Element
  readonly shortcut?: JSX.Element
  readonly onSelect: () => void
  readonly onActivate: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      id={props.id}
      data-slot="session-composer-completion-row"
      data-kind={props.kind}
      role="option"
      aria-selected={props.active}
      data-active={props.active ? "" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={props.onActivate}
      onClick={props.onSelect}
    >
      <span data-slot="session-composer-completion-icon" data-kind={props.kind} aria-hidden="true">
        {props.icon}
      </span>
      <span data-slot="session-composer-completion-label">
        <bdi dir="auto">{props.label}</bdi>
      </span>
      <Show when={props.description}>
        {(description) => <span data-slot="session-composer-completion-description">{description()}</span>}
      </Show>
      <Show when={props.shortcut}>
        {(shortcut) => <span data-slot="session-composer-completion-shortcut">{shortcut()}</span>}
      </Show>
    </button>
  )
}

export function ComposerCompletionGroup(props: ParentProps): JSX.Element {
  return (
    <div data-slot="session-composer-completion-group" aria-hidden="true">
      {props.children}
    </div>
  )
}

export function ComposerCompletionState(props: ParentProps): JSX.Element {
  return (
    <div data-slot="session-composer-completion-state" role="status">
      {props.children}
    </div>
  )
}
