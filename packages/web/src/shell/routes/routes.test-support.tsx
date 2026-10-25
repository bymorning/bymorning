import type { JSX } from "solid-js"

/** A route stand-in that renders its children inside a labelled wrapper, so a test can see what is nested where. */
export const wrapper =
  (name: string) =>
  (props: { readonly children?: JSX.Element }): JSX.Element => <div data-marker={name}>{props.children}</div>

/** A leaf page stand-in. */
export const page = (name: string) => (): JSX.Element => <output data-marker={`page:${name}`} />
