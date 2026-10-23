import { QueryClientProvider } from "@tanstack/solid-query"
import { render } from "@solidjs/testing-library"
import { onCleanup, type JSX } from "solid-js"
import { createQuery } from "../runtime/server/query"

export function renderForm(content: () => JSX.Element) {
  const client = createQuery()
  const view = render(content, { wrapper: (props) => {
    onCleanup(() => client.clear())
    return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  } })
  return { ...view, client }
}
