import { Show, type JSX, type ParentProps } from "solid-js"

import "./catalog.css"

export function Catalog(props: ParentProps<{ readonly "aria-label"?: string }>): JSX.Element {
  return (
    <ul data-component="catalog" aria-label={props["aria-label"]}>
      {props.children}
    </ul>
  )
}

export function CatalogRow(props: ParentProps): JSX.Element {
  return <li data-slot="catalog-row">{props.children}</li>
}

export function CatalogBody(props: ParentProps): JSX.Element {
  return <div data-slot="catalog-body">{props.children}</div>
}

export function CatalogTrigger(
  props: ParentProps<{
    readonly "aria-label": string
    readonly onClick: () => void
  }>,
): JSX.Element {
  return (
    <button type="button" data-slot="catalog-body" aria-label={props["aria-label"]} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

export function CatalogCopy(props: {
  readonly title: string
  readonly description?: string | undefined
  readonly error?: string | undefined
}): JSX.Element {
  return (
    <span data-slot="catalog-copy">
      <strong>{props.title}</strong>
      <Show when={props.description}>{(description) => <span>{description()}</span>}</Show>
      <Show when={props.error}>{(error) => <span role="alert">{error()}</span>}</Show>
    </span>
  )
}
