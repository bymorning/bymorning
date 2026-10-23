import type { JSX } from "solid-js"

import { SharePage } from "../../share/page"
import { shareConversation } from "../../share/fixture"

/** Session-identical public Share workspace driven by a mocked Share view. */
export function ShareUIPrototypeRoute(): JSX.Element {
  const view = shareConversation()
  return <SharePage status="ready" title={view.title} messages={view.messages} />
}
