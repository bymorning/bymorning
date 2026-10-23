import { CloseButton, Content, Description, Title } from "@kobalte/core/dialog"
import { type ComponentProps, type JSXElement, type ParentProps, Show, children, splitProps } from "solid-js"
import { useEntry } from "../../context/dialog"
import { useI18n } from "../context/i18n"
import { OverlayHost } from "./overlay-host"
import "./dialog.css"

export interface DialogProps extends ParentProps {
  size?: "normal" | "large" | "x-large" | "full"
  /** `card` matches the public entry cards: padded surface, page title, full-width actions. */
  variant?: "default" | "card"
  class?: ComponentProps<"div">["class"]
  containerClass?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  "aria-label"?: string
  "aria-busy"?: boolean
  "data-component"?: string
}

export interface DialogHeaderProps extends ParentProps {
  closeLabel?: string
  hideClose?: boolean
}

export interface DialogTitleGroupProps {
  title?: JSXElement
  description: JSXElement
}

export function DialogFooter(props: ParentProps & { "data-component"?: string }) {
  return (
    <div data-slot="dialog-footer" data-component={props["data-component"]}>
      {props.children}
    </div>
  )
}

export function DialogBody(props: ParentProps & { class?: ComponentProps<"div">["class"] }) {
  const [local] = splitProps(props, ["class", "children"])
  return (
    <div data-slot="dialog-body" class={local.class}>
      {local.children}
    </div>
  )
}

export function DialogTitle(props: ParentProps) {
  return <Title data-slot="dialog-header-title">{props.children}</Title>
}

export function DialogTitleGroup(props: DialogTitleGroupProps) {
  const title = children(() => props.title)
  const description = children(() => props.description)

  return (
    <div data-slot="dialog-title-group">
      <Show when={title()}>{(t) => <Title data-slot="dialog-title">{t()}</Title>}</Show>
      <Description data-slot="dialog-description">{description()}</Description>
    </div>
  )
}

export function DialogHeader(props: DialogHeaderProps) {
  const i18n = useI18n()
  const [local] = splitProps(props, ["closeLabel", "hideClose", "children"])
  const hideClose = () => local.hideClose === true

  return (
    <div data-slot="dialog-header" data-hide-close={hideClose() ? "" : undefined}>
      {local.children}
      {!hideClose() && (
        <CloseButton data-slot="dialog-close-button" aria-label={local.closeLabel ?? i18n.t("ui.common.close")}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12.4446 3.55469L3.55566 12.4436M3.55566 3.55469L12.4446 12.4436"
              stroke="currentColor"
              stroke-linejoin="round"
            />
          </svg>
        </CloseButton>
      )}
    </div>
  )
}

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    "size",
    "variant",
    "class",
    "containerClass",
    "classList",
    "fit",
    "onEscapeKeyDown",
    "aria-label",
    "aria-busy",
    "data-component",
    "children",
  ])
  const entry = useEntry()

  return (
    <Content
      data-component="dialog"
      data-variant={local.variant && local.variant !== "default" ? local.variant : undefined}
      data-fit={local.fit ? true : undefined}
      data-size={local.size || "normal"}
      data-slot="dialog-scope"
      {...(local.onEscapeKeyDown ? { onEscapeKeyDown: local.onEscapeKeyDown } : {})}
      aria-label={local["aria-label"]}
      aria-busy={local["aria-busy"]}
      // A covered dialog is non-modal while another is pushed above it; Kobalte would
      // otherwise dismiss it as soon as focus moves into the dialog on top.
      onFocusOutside={(e) => e.preventDefault()}
      onOpenAutoFocus={(e) => {
        if (!(e.currentTarget instanceof HTMLElement)) return
        const autofocusEl = e.currentTarget.querySelector("[autofocus]")
        if (autofocusEl instanceof HTMLElement) {
          e.preventDefault()
          autofocusEl.focus({ preventScroll: true })
        }
      }}
      onClick={(event: MouseEvent) => {
        // Kobalte's modal dismissable layer forces this full-viewport node to
        // `pointer-events: auto`, which otherwise swallows clicks in the space
        // around the dialog box before they can reach the overlay behind it.
        // Treat a click that lands directly on this node (not one that bubbled
        // up from the visible dialog box) as a click outside the dialog.
        if (event.target === event.currentTarget) entry.dismiss()
      }}
    >
      <OverlayHost>
        <div data-component={local["data-component"]} data-slot="dialog-container" class={local.containerClass}>
          <div
            data-slot="dialog-content"
            classList={{
              ...local.classList,
              [local.class ?? ""]: !!local.class,
            }}
          >
            {local.children}
          </div>
        </div>
      </OverlayHost>
    </Content>
  )
}
