import { Show, type JSX } from "solid-js"

import type { SessionListScrollController } from "../features/session-list/session-list-scroll-controller"
import { ScrollView } from "../ui/scroll-view"
import "./layout.css"

export function HomeLayout(props: {
  readonly title: string
  readonly description: string
  readonly actions?: JSX.Element
  /** Content placed between the header and the main card, outside the card frame. */
  readonly before?: JSX.Element
  readonly main: JSX.Element
  /** Omits the main card entirely; the card frame is never shown empty. */
  readonly mainHidden?: boolean
  readonly scroll: SessionListScrollController
}) {
  return (
    <section data-component="home-layout">
      <ScrollView
        data-slot="home-layout-scroll"
        fill
        containOverscroll
        role="region"
        aria-label="Home content"
        tabIndex={0}
        viewportRef={props.scroll.viewport.setViewport}
        onScroll={(event) => props.scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={props.scroll.viewport.containOuterWheel}
      >
        <div data-slot="home-layout-content">
          <header data-slot="home-layout-header">
            <div data-slot="home-layout-heading">
              <h1>{props.title}</h1>
              <p>{props.description}</p>
            </div>
            {props.actions && <div data-slot="home-layout-actions">{props.actions}</div>}
          </header>
          {props.before}
          <Show when={!props.mainHidden}>
            <div data-slot="home-layout-main">{props.main}</div>
          </Show>
        </div>
      </ScrollView>
    </section>
  )
}
