import { createMemo, Show, type JSX } from "solid-js"
import stripAnsi from "strip-ansi"

import { TextShimmer } from "../../../../ui/components/text-shimmer"
import { useI18n } from "../../../../ui/context/i18n"
import { BasicTool } from "../basic-tool"
import { CopyAction } from "../message-action"
import { createScrollFade } from "../../../../ui/components/scroll-fade"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import "./execute-tool.css"

function ExecuteTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const running = () => props.tool.state.type === "running"
  const fade = createScrollFade()
  // Models often open the program with a blank line; it would render as an empty first row.
  const code = createMemo(() => {
    const value =
      typeof props.tool.input.code === "string"
        ? props.tool.input.code
        : typeof props.tool.input.path === "string"
          ? props.tool.input.path
          : ""
    return value.replace(/^(?:[ \t]*\r?\n)+/, "")
  })
  const description = createMemo(() => {
    const value = props.tool.input.description
    return typeof value === "string" ? value.trim() : ""
  })
  const label = createMemo(() => description() || (code().split("\n")[0] ?? ""))
  // A call cut short before it finished may have no input yet, which would leave a bare title.
  const ended = () =>
    props.tool.state.type === "interrupted"
      ? i18n.t("ui.message.interrupted")
      : props.tool.state.type === "stopped"
        ? i18n.t("ui.tool.stopped")
        : undefined
  // Code Mode reports a thrown or rejected program as a completed call flagged `error`.
  const failed = () => {
    if (props.tool.state.type !== "succeeded") return false
    const result = props.tool.state.result
    return !!result && typeof result === "object" && !Array.isArray(result) && Reflect.get(result, "error") === true
  }
  const output = createMemo(() => {
    if (props.tool.state.type !== "succeeded") return ""
    const result = props.tool.state.result
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const text = Reflect.get(result, "output")
      if (typeof text === "string") return stripAnsi(text).replace(/\r\n?/g, "\n")
      const stdout = Reflect.get(result, "stdout")
      const stderr = Reflect.get(result, "stderr")
      if (typeof stdout === "string" && typeof stderr === "string") {
        const text = [stdout, stderr].filter(Boolean).join("\n")
        const value = Reflect.get(result, "exitCode")
        const exitCode = typeof value === "number" && Number.isFinite(value) ? value : 0
        return stripAnsi(text || `(exit ${exitCode})`).replace(/\r\n?/g, "\n")
      }
    }
    return stripAnsi(props.tool.state.output ?? "").replace(/\r\n?/g, "\n")
  })

  return (
    <div data-component="execute-tool">
      <BasicTool
        tool={props.tool.name}
        title={i18n.t("ui.tool.execute")}
        status={props.tool.state.type === "failed" ? "stopped" : props.tool.state.type}
        summary={label()}
        rail={false}
        compact
        allowOpenWhilePending
        trigger={
          <div data-component="execute-tool-trigger" data-label={description() ? "description" : "code"} dir="ltr">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.execute")} active={running()} />
            </span>
            <Show when={label()}>{(value) => <span data-slot="basic-tool-tool-subtitle">{value()}</span>}</Show>
            <Show when={ended()}>{(value) => <span data-slot="execute-tool-ended">{value()}</span>}</Show>
            <Show when={failed()}>
              <span data-slot="execute-tool-failed">{i18n.t("ui.tool.failed")}</span>
            </Show>
          </div>
        }
        {...(props.open === undefined ? {} : { open: props.open })}
        {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
        {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
      >
        <div
          data-component="execute-output"
          data-scroll-fade
          dir="ltr"
          data-fade-above={fade.above() ? "" : undefined}
          data-fade-below={fade.below() ? "" : undefined}
        >
          <Show when={code()}>
            {(value) => (
              <div data-slot="execute-copy">
                <CopyAction text={value()} label={i18n.t("ui.tool.copy")} />
              </div>
            )}
          </Show>
          <div
            data-slot="execute-scroll"
            data-scrollable
            ref={fade.ref}
            onScroll={fade.onScroll}
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.tool.output")}
          >
            <pre data-slot="execute-pre">
              <code>
                <span data-slot="execute-code">{code()}</span>
                <Show when={output()}>
                  {(value) => (
                    <span data-slot="execute-result" data-error={failed() ? "" : undefined}>
                      {value()}
                    </span>
                  )}
                </Show>
              </code>
            </pre>
          </div>
        </div>
      </BasicTool>
    </div>
  )
}

ToolRegistry.register({ name: "execute", render: ExecuteTool })
