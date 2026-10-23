import { For, Show, type JSX } from "solid-js"

import { GenericTool } from "../basic-tool"
import { FileTool } from "./file-tool"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import "./write-tool.css"

function WriteTool(props: ToolRendererProps): JSX.Element {
  const input = () => {
    const path = props.tool.input.path
    const content = props.tool.input.content
    if (typeof path !== "string" || path.length === 0 || typeof content !== "string") return undefined
    return { path, content }
  }
  const diagnostics = () => {
    const value = input()
    const byFile = props.tool.metadata.diagnostics
    if (!value || typeof byFile !== "object" || byFile === null || Array.isArray(byFile)) return []
    const entries = Reflect.get(byFile, value.path)
    if (!Array.isArray(entries)) return []
    return entries
      .flatMap((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return []
        if (Reflect.get(entry, "severity") !== 1 || typeof Reflect.get(entry, "message") !== "string") return []
        const range = Reflect.get(entry, "range")
        if (typeof range !== "object" || range === null || Array.isArray(range)) return []
        const start = Reflect.get(range, "start")
        if (typeof start !== "object" || start === null || Array.isArray(start)) return []
        const line = Reflect.get(start, "line")
        const character = Reflect.get(start, "character")
        const message = Reflect.get(entry, "message")
        if (
          typeof line !== "number" ||
          !Number.isFinite(line) ||
          !Number.isInteger(line) ||
          line < 0 ||
          typeof character !== "number" ||
          !Number.isFinite(character) ||
          !Number.isInteger(character) ||
          character < 0 ||
          typeof message !== "string"
        )
          return []
        return [{ message, line: line + 1, character: character + 1 }]
      })
      .slice(0, 3)
  }
  return (
    <Show
      keyed
      when={input()}
      fallback={
        <GenericTool
          tool={props.tool}
          {...(props.open === undefined ? {} : { open: props.open })}
          {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
          {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
        />
      }
    >
      {(value) => (
        <div data-component="write-tool">
          <FileTool
            type="write"
            path={value.path}
            status={props.tool.state.type === "failed" ? "stopped" : props.tool.state.type}
            openFile={() => props.actions.openFile(value.path)}
            open={props.open}
            onOpenChange={props.onOpenChange}
            onContentRendered={props.onContentRendered}
          >
            <pre data-slot="write-tool-source">{value.content}</pre>
            <Show when={diagnostics().length > 0}>
              <div data-slot="write-tool-diagnostics" role="list" aria-label="Write errors">
                <For each={diagnostics()}>
                  {(diagnostic) => (
                    <div data-slot="write-tool-diagnostic" role="listitem">
                      <strong>Error</strong> [{diagnostic.line}:{diagnostic.character}] {diagnostic.message}
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </FileTool>
        </div>
      )}
    </Show>
  )
}

ToolRegistry.register({ name: "write", render: WriteTool })
