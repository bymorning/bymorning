import { createSignal, onCleanup, type JSX } from "solid-js"

import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import { Tooltip } from "../../../ui/components/tooltip"
import { useI18n } from "../../../ui/context/i18n"
import { copyToClipboard } from "../../../ui/clipboard"
import "./message-action.css"

export function MessageAction(props: {
  readonly owner: "user" | "assistant"
  readonly children: JSX.Element
  readonly interrupted?: boolean
}): JSX.Element {
  return (
    <div
      data-component="message-action"
      data-owner={props.owner}
      data-interrupted={props.interrupted ? "" : undefined}
      data-slot={props.owner === "user" ? "user-message-copy-wrapper" : "text-part-copy-wrapper"}
    >
      {props.children}
    </div>
  )
}

export function CopyAction(props: { readonly text: string; readonly label: string }): JSX.Element {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let reset: ReturnType<typeof setTimeout> | undefined
  let active = true

  onCleanup(() => {
    active = false
    clearTimeout(reset)
  })

  return (
    <Tooltip value={copied() ? i18n.t("ui.tool.copied") : props.label}>
      <IconButton
        type="button"
        size="small"
        variant="ghost-muted"
        aria-label={copied() ? i18n.t("ui.tool.copied") : props.label}
        onClick={() => {
          void copyToClipboard(props.text).then((result) => {
            if (result !== "copied") return
            if (!active) return
            setCopied(true)
            clearTimeout(reset)
            reset = setTimeout(() => setCopied(false), 2_000)
          })
        }}
        icon={<Icon name={copied() ? "check" : "outline-copy"} />}
      />
    </Tooltip>
  )
}
