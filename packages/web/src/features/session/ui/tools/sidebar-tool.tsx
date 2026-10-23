import { createMemo, Show, type JSX } from "solid-js"

import { parseSidebar } from "../../sidebar-controller"
import { TextShimmer } from "../../../../ui/components/text-shimmer"
import { useI18n } from "../../../../ui/context/i18n"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import { ToolIcon } from "./tool-icon"
import "./sidebar-tool.css"

const marker = "__BYMORNING_SIDEBAR_PATH__"

/** The end state the Tool reported, preferring its validated result over the requested input. */
function request({ tool }: ToolRendererProps): ReturnType<typeof parseSidebar> {
  const source = tool.state.type === "succeeded" && tool.state.result ? tool.state.result : tool.input
  return parseSidebar(source)
}

function SidebarTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const value = createMemo(() => request(props))
  const path = () => {
    const current = value()
    return current?.open ? current.path : undefined
  }
  const label = () => {
    const current = value()
    if (current === undefined) return i18n.t("ui.tool.sidebar")
    return current.open ? i18n.t("ui.tool.sidebarOpened") : i18n.t("ui.tool.sidebarClosed")
  }
  const running = () => props.tool.state.type === "running"
  const showing = createMemo(() => i18n.t("ui.tool.sidebarShowing").split(marker))

  return (
    <Show
      when={path()}
      fallback={
        <div data-component="tool-loaded-item">
          <ToolIcon name="sidebar" />
          <TextShimmer text={label()} active={running()} />
        </div>
      }
    >
      {(path) => (
        <div data-component="tool-loaded-item">
          <ToolIcon name="sidebar" />
          <span data-slot="tool-loaded-label">{showing()[0]?.trim()}</span>
          <button
            type="button"
            data-slot="tool-loaded-value"
            onClick={() => props.actions.openFile(path())}
            title={path()}
          >
            <TextShimmer as="span" text={path()} active={running()} />
          </button>
          <Show when={showing()[1]?.trim()}>{(suffix) => <span data-slot="tool-loaded-label">{suffix()}</span>}</Show>
        </div>
      )}
    </Show>
  )
}

ToolRegistry.register({ name: "sidebar", render: SidebarTool })
