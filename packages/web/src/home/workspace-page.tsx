import type { JSX, ParentProps } from "solid-js"

import { Icon } from "../ui/components/icon"
import { ScrollView } from "../ui/scroll-view"
import "./workspace-page.css"

export function WorkspacePage(
  props: ParentProps<{
    readonly title: string
    readonly heading?: JSX.Element
    readonly description?: string
    readonly eyebrow?: string
    readonly leading?: JSX.Element
    readonly actions?: JSX.Element
    /** `wide` drops the content max width so wide tables can use the full page width (minus padding). */
    readonly layout?: "default" | "table" | "wide"
    /** Link to the parent page, shown above the title. */
    readonly back?: { readonly href: string; readonly label: string }
  }>,
): JSX.Element {
  return (
    <section data-component="workspace-page" data-layout={props.layout ?? "default"}>
      <ScrollView fill containOverscroll role="region" aria-label={`${props.title} page`} tabIndex={0}>
        <div data-slot="workspace-page-content">
          <header>
            {props.back && (
              <a data-slot="workspace-page-back" href={props.back.href}>
                <Icon name="central-arrow-left" size="small" />
                <span>{props.back.label}</span>
              </a>
            )}
            <div data-slot="workspace-page-heading">
              <div data-slot="workspace-page-identity">
                {props.leading && <div data-slot="workspace-page-leading">{props.leading}</div>}
                <div data-slot="workspace-page-title">
                  {props.eyebrow && <p data-slot="workspace-page-eyebrow">{props.eyebrow}</p>}
                  <h1>{props.heading ?? props.title}</h1>
                  {props.description && <p data-slot="workspace-page-description">{props.description}</p>}
                </div>
              </div>
              {props.actions && <div data-slot="workspace-page-actions">{props.actions}</div>}
            </div>
          </header>
          <div data-slot="workspace-page-card">{props.children}</div>
        </div>
      </ScrollView>
    </section>
  )
}
