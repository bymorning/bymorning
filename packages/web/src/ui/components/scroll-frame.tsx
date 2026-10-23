import { splitProps, type JSX } from "solid-js"

import { createScrollFade } from "./scroll-fade"

/**
 * A horizontally scrolling table frame. The frame owns the rounded border and clip; the keyboard-focusable
 * scroller inside it carries the caller's attributes. Edges fade into the surface only while they can scroll.
 */
export function ScrollFrame(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  const fade = createScrollFade({ axis: "x" })
  return (
    <div
      data-scroll-fade
      data-fade-axis="x"
      data-fade-above={fade.above() ? "" : undefined}
      data-fade-below={fade.below() ? "" : undefined}
    >
      <div {...rest} ref={fade.ref} onScroll={fade.onScroll} tabIndex={0}>
        {local.children}
      </div>
    </div>
  )
}
