import { Show, type JSX } from "solid-js"

import { Button } from "../../../../ui/components/button"
import { FileIcon } from "../../../../ui/components/file-icon"
import { TextShimmer } from "../../../../ui/components/text-shimmer"
import { useI18n } from "../../../../ui/context/i18n"
import { BasicTool } from "../basic-tool"
import type { SessionUI } from "../session-model"
import "./file-tool.css"

export function FileTool(props: {
  readonly type: "write" | "edit"
  readonly path: string
  readonly status: Exclude<SessionUI.ToolState["type"], "failed">
  readonly openFile: () => void
  readonly children: JSX.Element
  readonly open?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly onContentRendered?: (() => void) | undefined
}): JSX.Element {
  const i18n = useI18n()
  const title = () => {
    const action = i18n.t(props.type === "edit" ? "ui.tool.edit" : "ui.tool.write")
    if (props.status === "interrupted" || props.status === "stopped")
      return `${action} ${i18n.t(props.status === "interrupted" ? "ui.tool.interrupted" : "ui.tool.stopped")}`
    return action
  }
  const filename = () => props.path.split(/[\\/]/).at(-1) ?? props.path
  const directory = () => props.path.slice(0, Math.max(props.path.lastIndexOf("/"), props.path.lastIndexOf("\\")) + 1)
  return (
    <div data-component="file-tool" data-tool={props.type}>
      <BasicTool
        tool={props.type}
        title={title()}
        status={props.status}
        summary={props.path}
        trigger={
          <div data-component={`${props.type}-trigger`}>
            <bdi data-slot="message-part-bidi-label" class="sr-only">
              {props.path}
            </bdi>
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">
                  <TextShimmer text={title()} active={props.status === "running"} />
                </span>
                <Show when={props.status !== "running"}>
                  <span data-slot="message-part-title-filename">{filename()}</span>
                </Show>
              </div>
              <Show when={props.status !== "running" && directory()}>
                <div data-slot="message-part-path">{directory()}</div>
              </Show>
            </div>
          </div>
        }
        {...(props.open === undefined ? {} : { open: props.open })}
        {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
        {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
      >
        <div data-slot="file-tool-header">
          <FileIcon data-slot="file-tool-icon" node={{ path: props.path, type: "file" }} aria-hidden="true" />
          <code data-slot="file-tool-path">
            <bdi>{props.path}</bdi>
          </code>
          <Button type="button" size="small" variant="outline" onClick={props.openFile}>
            {i18n.t("ui.tool.openFile")}
          </Button>
        </div>
        {props.children}
      </BasicTool>
    </div>
  )
}
