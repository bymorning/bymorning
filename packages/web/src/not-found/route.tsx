import { A } from "@solidjs/router"
import { createEffect, onCleanup, type JSX } from "solid-js"
import { Button } from "../ui/components/button"
import "./route.css"

/** Render a not-found message with a single way back. */
export function NotFoundState(props: {
  readonly title: string
  readonly description: string
  readonly href: string
  readonly action: string
}): JSX.Element {
  // Restore whatever owned the title before (the shell's route title or the product name).
  const previous = document.title
  createEffect(() => {
    document.title = `${props.title} · ByMorning`
  })
  onCleanup(() => {
    document.title = previous
  })
  return (
    <section data-component="not-found">
      <h1 data-slot="not-found-title">{props.title}</h1>
      <p data-slot="not-found-description">{props.description}</p>
      <Button as={A} href={props.href} variant="primary" size="large">
        {props.action}
      </Button>
    </section>
  )
}

/** Render the fallback route for an unknown URL. */
export function NotFoundRoute(): JSX.Element {
  return (
    <NotFoundState
      title="404: Not Found"
      description="The requested page does not exist."
      href="/"
      action="Return home"
    />
  )
}
