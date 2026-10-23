import { splitProps, type ComponentProps, type JSX, type ParentProps } from "solid-js"

import { Wordmark } from "./wordmark"
import "./card-page.css"

/**
 * A standalone page that centers one card under the wordmark. Used by the
 * public entry routes (login, setup, OAuth consent) so they share one layout.
 */
function CardPageRoot(props: ParentProps<ComponentProps<"main">>): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <main {...rest} data-component="card-page">
      <section data-slot="card-page-card">
        <div data-slot="card-page-eyebrow">
          <Wordmark size={18} />
        </div>
        {local.children}
      </section>
    </main>
  )
}

function Title(props: ParentProps<ComponentProps<"h1">>): JSX.Element {
  return <h1 {...props} data-slot="card-page-title" />
}

function Description(props: ParentProps<ComponentProps<"p">>): JSX.Element {
  return <p {...props} data-slot="card-page-description" />
}

/** A live status or alert line. */
function Message(props: ParentProps<ComponentProps<"p"> & { readonly role: "status" | "alert" }>): JSX.Element {
  return <p {...props} data-slot="card-page-message" />
}

/** The card's interactive region: forms, actions, and lists stacked with one gap. */
function Body(props: ParentProps<ComponentProps<"div">>): JSX.Element {
  return <div {...props} data-slot="card-page-body" />
}

export const CardPage = Object.assign(CardPageRoot, { Title, Description, Message, Body })
