import { createMemo, createSignal, createUniqueId, Show, type JSX } from "solid-js"

import { Icon } from "../../../ui/components/icon"
import { useI18n } from "../../../ui/context/i18n"
import { CopyAction } from "./message-action"
import { toolLabel } from "./tools/tool-label"
import "./basic-tool.css"
import "./tool-error-card.css"

export function ToolErrorCard(props: {
  readonly name: string
  readonly summary: string | undefined
  readonly message: string
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const [localOpen, setLocalOpen] = createSignal(false)
  const triggerID = createUniqueId()
  const contentID = createUniqueId()
  const cleaned = createMemo(() => props.message.replace(/^Error:\s*/, "").trim())
  const detail = createMemo(() => {
    const prefix = `${props.name} failed: `
    if (cleaned().toLowerCase().startsWith(prefix.toLowerCase())) return cleaned().slice(prefix.length)
    return cleaned()
  })
  const open = () => props.open ?? localOpen()
  const toggle = () => {
    if (!detail()) return
    const next = !open()
    if (props.open === undefined) setLocalOpen(next)
    props.onOpenChange?.(next)
    queueMicrotask(() => props.onContentRendered?.())
  }
  return (
    <div data-component="card" data-kind="tool-error-card" data-open={open() ? "true" : "false"}>
      <div data-component="tool-collapsible" data-open={open() ? "true" : "false"} data-rail="false">
        <button
          id={triggerID}
          type="button"
          data-slot="tool-collapsible-trigger"
          aria-label={[
            toolLabel(props.name),
            props.summary,
            i18n.t("ui.tool.failed"),
            detail() ? i18n.t(open() ? "ui.tool.expanded" : "ui.tool.collapsed") : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-controls={detail() ? contentID : undefined}
          aria-expanded={detail() ? open() : undefined}
          disabled={!detail()}
          onClick={toggle}
        >
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon">
                <Icon name="circle-ban-sign" size="small" />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{toolLabel(props.name)}</span>
                    <Show when={props.summary}>
                      {(value) => <bdi data-slot="basic-tool-tool-subtitle">{value()}</bdi>}
                    </Show>
                    <span data-slot="tool-error-card-dot" aria-hidden="true">
                      ·
                    </span>
                    <span data-slot="tool-error-card-summary">{i18n.t("ui.tool.failed")}</span>
                  </div>
                </div>
              </div>
            </div>
            <Show when={detail()}>
              <svg data-slot="tool-collapsible-arrow" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path d="M4 5.5 7 8.5l3-3" fill="none" stroke="currentColor" />
              </svg>
            </Show>
          </div>
        </button>
        <Show when={detail()}>
          <div
            id={contentID}
            role="region"
            aria-labelledby={triggerID}
            data-slot="tool-collapsible-content"
            hidden={!open()}
          >
            <div data-slot="tool-error-card-content">
              <div data-slot="tool-error-card-copy">
                <CopyAction text={cleaned()} label={i18n.t("ui.tool.copyError")} />
              </div>
              <div data-slot="card-description">{detail()}</div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
