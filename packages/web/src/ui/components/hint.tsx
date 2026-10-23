import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Icon } from "./icon"
import { Tooltip } from "./tooltip"
import "./hint.css"

/**
 * A small help icon that explains the element beside it. The explanation shows
 * on hover or focus and toggles on click or tap, so it works without a mouse.
 */
export function Hint(props: { readonly text: string }): JSX.Element {
  const [state, setState] = createStore({ open: false })
  return (
    <Tooltip value={props.text} forceOpen={state.open}>
      <button
        type="button"
        data-component="hint"
        aria-label={props.text}
        onClick={() => setState("open", !state.open)}
        onBlur={() => setState("open", false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && state.open) {
            event.stopPropagation()
            setState("open", false)
          }
        }}
      >
        <Icon name="help" size="small" />
      </button>
    </Tooltip>
  )
}
