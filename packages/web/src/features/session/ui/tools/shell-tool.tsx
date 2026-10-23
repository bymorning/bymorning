import { createMemo, Show, type JSX } from "solid-js"
import stripAnsi from "strip-ansi"

import { TextShimmer } from "../../../../ui/components/text-shimmer"
import { useI18n } from "../../../../ui/context/i18n"
import { BasicTool } from "../basic-tool"
import { CopyAction } from "../message-action"
import { createScrollFade } from "../../../../ui/components/scroll-fade"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import "./shell-tool.css"

function ShellTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const fade = createScrollFade()
  const running = () => props.tool.state.type === "running"
  const command = createMemo(() => {
    if (typeof props.tool.input.command === "string") return props.tool.input.command
    return typeof props.tool.metadata.command === "string" ? props.tool.metadata.command : ""
  })
  const output = createMemo(() => {
    if (props.tool.state.type !== "succeeded") return ""
    const result = props.tool.state.result
    if (result && typeof result === "object" && !Array.isArray(result)) {
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
    <div data-component="shell-tool">
      <BasicTool
        tool={props.tool.name}
        title={i18n.t("ui.tool.shell")}
        status={props.tool.state.type === "failed" ? "stopped" : props.tool.state.type}
        summary={command()}
        rail={false}
        compact
        allowOpenWhilePending
        trigger={
          <div data-component="shell-tool-trigger" dir="ltr">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.shell")} active={running()} />
            </span>
            <Show
              when={command()}
              fallback={
                <Show when={running()}>
                  <span data-slot="basic-tool-tool-subtitle">{i18n.t("ui.tool.shell.writingCommand")}</span>
                </Show>
              }
            >
              {(value) => <span data-slot="basic-tool-tool-subtitle">{value()}</span>}
            </Show>
          </div>
        }
        {...(props.open === undefined ? {} : { open: props.open })}
        {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
        {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
      >
        <div
          data-component="shell-output"
          data-scroll-fade
          dir="ltr"
          data-fade-above={fade.above() ? "" : undefined}
          data-fade-below={fade.below() ? "" : undefined}
        >
          <Show when={command()}>
            {(value) => (
              <div data-slot="shell-copy">
                <CopyAction text={value()} label={i18n.t("ui.tool.copy")} />
              </div>
            )}
          </Show>
          <div
            data-slot="shell-scroll"
            data-scrollable
            ref={fade.ref}
            onScroll={fade.onScroll}
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.tool.output")}
          >
            <pre data-slot="shell-pre">
              <code>
                <span data-slot="shell-command">{command()}</span>
                <Show when={output()}>{(value) => <span data-slot="shell-result">{value()}</span>}</Show>
              </code>
            </pre>
          </div>
        </div>
      </BasicTool>
    </div>
  )
}

ToolRegistry.register({ name: "shell", render: ShellTool })
