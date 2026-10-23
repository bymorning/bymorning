import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import { onCleanup, onMount, splitProps, Show, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useSession } from "../../context/session.js"
import "./tooltip.css"

export interface TooltipProps extends ComponentProps<typeof Root> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
}

export function Tooltip(props: TooltipProps) {
  const session = useSession()
  const mount = session.portal()
  let ref: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "ignoreSafeArea",
    "value",
  ])

  const close = () => setState("open", false)

  const inside = () => {
    const active = document.activeElement
    if (!ref || !active) return false
    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand) return
    if (ref?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const assignTrigger = (element: HTMLDivElement) => {
    ref = element
    element.addEventListener("pointerdown", arm, { capture: true })
    element.addEventListener("keydown", armOnKeyDown, { capture: true })
    onCleanup(() => {
      element.removeEventListener("pointerdown", arm, { capture: true })
      element.removeEventListener("keydown", armOnKeyDown, { capture: true })
    })
  }

  const armOnKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    arm()
  }

  const leave = () => {
    if (!inside()) close()
    drop()
  }

  // `ref` is only assigned when the trigger branch renders, so this is a mount-time
  // sync rather than a reactive effect.
  onMount(() => {
    if (!ref) return
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false

  return (
    <Show when={!local.inactive} fallback={local.children}>
      <Root
        gutter={4}
        openDelay={400}
        skipDelayDuration={300}
        {...others}
        closeDelay={0}
        ignoreSafeArea={local.ignoreSafeArea ?? true}
        open={local.forceOpen || state.open}
        onOpenChange={(open) => {
          if (local.forceOpen) return
          if (state.block && open) return
          if (justClickedTrigger) {
            justClickedTrigger = false
            return
          }
          setState("open", open)
        }}
      >
        <Trigger
          ref={assignTrigger}
          as="div"
          data-component="tooltip-trigger"
          class={local.class}
          onPointerLeave={leave}
          onFocusOut={() => requestAnimationFrame(() => drop())}
        >
          {local.children}
        </Trigger>
        <Portal {...(mount === undefined ? {} : { mount })}>
          <Content
            data-component="tooltip"
            data-placement={props.placement}
            data-force-open={local.forceOpen}
            {...(local.contentClass === undefined ? {} : { class: local.contentClass })}
            {...(local.contentStyle === undefined ? {} : { style: local.contentStyle })}
            onPointerDownOutside={(e) => {
              if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                justClickedTrigger = true
              }
              e.preventDefault()
            }}
          >
            {local.value}
          </Content>
        </Portal>
      </Root>
    </Show>
  )
}
