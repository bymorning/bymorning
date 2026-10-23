import { children, createEffect, createSignal, For, on, Show, type JSX } from "solid-js"

import { TextShimmer } from "../../../ui/components/text-shimmer"
import { useI18n } from "../../../ui/context/i18n"
import type { SessionUI } from "./session-model"
import { ToolIcon } from "./tools/tool-icon"
import "./basic-tool.css"

type ToolStatus = "running" | "succeeded" | "interrupted" | "stopped"

export function BasicTool(props: {
  readonly tool?: string
  readonly title?: string
  readonly status: ToolStatus
  readonly summary?: string | undefined
  readonly args?: ReadonlyArray<string>
  readonly trigger?: JSX.Element
  readonly children?: JSX.Element
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
  readonly allowOpenWhilePending?: boolean
  readonly compact?: boolean
  readonly rail?: boolean
  readonly locked?: boolean
}): JSX.Element {
  const i18n = useI18n()
  const content = children(() => props.children)
  content()
  const pending = () => props.status === "running"
  const expandable = () => content() !== undefined && (!pending() || props.allowOpenWhilePending)
  const [localOpen, setLocalOpen] = createSignal(false)
  const open = () => props.locked || (props.open ?? localOpen())
  createEffect(on(open, () => queueMicrotask(() => props.onContentRendered?.())))
  const change = (value: boolean) => {
    if (props.locked || !expandable()) return
    if (props.open === undefined) setLocalOpen(value)
    props.onOpenChange?.(value)
  }
  const label = () =>
    [props.title, props.summary, expandable() ? i18n.t(open() ? "ui.tool.expanded" : "ui.tool.collapsed") : undefined]
      .filter(Boolean)
      .join(" ")
  const trigger = () => (
    <div data-component="tool-trigger" data-status={props.status}>
      <div data-slot="basic-tool-tool-trigger-content">
        <Show when={props.tool}>{(name) => <ToolIcon name={name()} />}</Show>
        <div data-slot="basic-tool-tool-info">
          <Show
            when={props.trigger}
            fallback={
              <div data-slot="basic-tool-tool-info-structured">
                <div data-slot="basic-tool-tool-info-main">
                  <span data-slot="basic-tool-tool-title">
                    <TextShimmer text={props.title ?? i18n.t("ui.tool.tool")} active={pending()} />
                  </span>
                  <Show when={props.summary}>
                    {(value) => <bdi data-slot="basic-tool-tool-subtitle">{value()}</bdi>}
                  </Show>
                  <For each={props.args}>{(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}</For>
                </div>
              </div>
            }
          >
            {props.trigger}
          </Show>
        </div>
      </div>
      <Show when={expandable() && !props.locked}>
        <svg data-slot="tool-collapsible-arrow" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <path d="M4 5.5 7 8.5l3-3" fill="none" stroke="currentColor" />
        </svg>
      </Show>
    </div>
  )
  return (
    <div
      data-component="tool-collapsible"
      data-open={open() ? "true" : "false"}
      data-compact={props.compact ? "true" : undefined}
      data-rail={props.rail === false ? "false" : undefined}
    >
      <Show
        when={!props.locked}
        fallback={
          <div data-slot="tool-collapsible-trigger" data-locked>
            {trigger()}
          </div>
        }
      >
        <button
          type="button"
          data-slot="tool-collapsible-trigger"
          aria-label={label()}
          aria-expanded={expandable() ? open() : undefined}
          onClick={() => change(!open())}
          disabled={!expandable()}
        >
          {trigger()}
        </button>
      </Show>
      <Show when={content() !== undefined && open()}>
        <div data-slot="tool-collapsible-content" role={props.locked ? undefined : "region"} aria-label={props.title}>
          {content()}
        </div>
      </Show>
    </div>
  )
}

export function GenericTool(props: {
  readonly tool: SessionUI.ToolPart
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  const i18n = useI18n()
  const output = () => (props.tool.state.type === "succeeded" ? props.tool.state.output : undefined)
  const state = () => (props.tool.state.type === "failed" ? "stopped" : props.tool.state.type)
  return (
    <BasicTool
      tool={props.tool.name}
      title={`${i18n.t("ui.tool.called")} ${props.tool.name}`}
      status={state()}
      args={toolArgs(props.tool)}
      {...(toolLabel(props.tool) === undefined ? {} : { summary: toolLabel(props.tool) })}
      {...(props.open === undefined ? {} : { open: props.open })}
      {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
      {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
    >
      <Show when={output()}>
        {(value) => (
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.tool.output")}
          >
            <pre>{value()}</pre>
          </div>
        )}
      </Show>
    </BasicTool>
  )
}

function toolLabel(tool: SessionUI.ToolPart) {
  if (tool.summary) return tool.summary
  return ["description", "query", "url", "path", "pattern", "name"]
    .map((key) => tool.input[key])
    .find((value): value is string => typeof value === "string" && value.length > 0)
}

function toolArgs(tool: SessionUI.ToolPart) {
  const skip = new Set(["description", "query", "url", "path", "pattern", "name"])
  const label = toolLabel(tool)
  return Object.entries(tool.input)
    .filter(([key, value]) => !skip.has(key) && value !== label)
    .flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [`${key}=${value}`] : [],
    )
    .slice(0, 3)
}
