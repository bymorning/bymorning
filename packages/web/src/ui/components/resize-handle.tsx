import { onCleanup, splitProps, type JSX } from "solid-js"

import "./resize-handle.css"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize" | "onMouseDown"> {
  readonly direction: "horizontal" | "vertical"
  readonly edge?: "start" | "end"
  readonly size: number
  readonly min: number
  readonly max: number
  readonly onResize: (size: number) => void
}

export function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const [local, rest] = splitProps(props, ["direction", "edge", "size", "min", "max", "onResize", "class", "classList"])
  let stopDrag: (() => void) | undefined

  onCleanup(() => stopDrag?.())

  return (
    <div
      role="separator"
      aria-orientation={local.direction === "horizontal" ? "vertical" : "horizontal"}
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onMouseDown={(event) => {
        if (event.detail > 1) return
        event.preventDefault()
        stopDrag?.()
        const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
        const start = local.direction === "horizontal" ? event.clientX : event.clientY
        const size = local.size
        const rtl = local.direction === "horizontal" && getComputedStyle(event.currentTarget).direction === "rtl"
        const bodyUserSelect = document.body.style.userSelect
        const bodyOverflow = document.body.style.overflow

        document.body.style.userSelect = "none"
        document.body.style.overflow = "hidden"

        const onMouseMove = (moveEvent: MouseEvent) => {
          const position = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
          const delta =
            local.direction === "vertical"
              ? edge === "end"
                ? position - start
                : start - position
              : (edge === "start") !== rtl
                ? start - position
                : position - start
          local.onResize(Math.min(local.max, Math.max(local.min, size + delta)))
        }
        const onMouseUp = () => {
          document.body.style.userSelect = bodyUserSelect
          document.body.style.overflow = bodyOverflow
          document.removeEventListener("mousemove", onMouseMove)
          document.removeEventListener("mouseup", onMouseUp)
          stopDrag = undefined
        }

        stopDrag = onMouseUp
        document.addEventListener("mousemove", onMouseMove)
        document.addEventListener("mouseup", onMouseUp)
      }}
    />
  )
}
