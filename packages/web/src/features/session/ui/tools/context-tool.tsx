import { For, Show, type JSX } from "solid-js"

import { useI18n } from "../../../../ui/context/i18n"
import { BasicTool } from "../basic-tool"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"

function ContextTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const output = () => (props.tool.state.type === "succeeded" ? props.tool.state.output : undefined)
  const status = () => (props.tool.state.type === "failed" ? "stopped" : props.tool.state.type)
  const path = () => (typeof props.tool.input.path === "string" ? props.tool.input.path : "/")
  const title = () => {
    if (props.tool.name === "read") return i18n.t("ui.tool.read")
    if (props.tool.name === "list") return i18n.t("ui.tool.list")
    if (props.tool.name === "glob") return i18n.t("ui.tool.glob")
    return i18n.t("ui.tool.grep")
  }
  const summary = () => {
    if (props.tool.name === "read") return path().split(/[\\/]/).at(-1) ?? path()
    const index = Math.max(path().lastIndexOf("/"), path().lastIndexOf("\\"))
    return index < 0 ? path() : path().slice(0, index + 1)
  }
  const args = () => [
    ...(typeof props.tool.input.pattern === "string" ? [`pattern=${props.tool.input.pattern}`] : []),
    ...(typeof props.tool.input.include === "string" ? [`include=${props.tool.input.include}`] : []),
    ...(typeof props.tool.input.offset === "number" ? [`offset=${props.tool.input.offset}`] : []),
    ...(typeof props.tool.input.limit === "number" ? [`limit=${props.tool.input.limit}`] : []),
  ]
  const loaded = () => {
    const value = props.tool.metadata.loaded
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : []
  }
  return (
    <>
      <BasicTool
        tool={props.tool.name}
        title={title()}
        status={status()}
        summary={summary()}
        args={args()}
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
              aria-label={`${title()} ${i18n.t("ui.tool.output")}`}
            >
              <pre>{value()}</pre>
            </div>
          )}
        </Show>
      </BasicTool>
      <For each={loaded()}>
        {(path) => (
          <div data-component="tool-loaded-item" aria-label={`${i18n.t("ui.tool.loaded")} ${path}`}>
            <span data-slot="tool-loaded-label" aria-hidden="true">
              {i18n.t("ui.tool.loaded")}
            </span>
            <span data-slot="tool-loaded-value" aria-hidden="true">
              {path}
            </span>
          </div>
        )}
      </For>
    </>
  )
}

for (const name of ["read", "list", "glob", "grep"]) ToolRegistry.register({ name, render: ContextTool })
