import { For, Show, type JSX } from "solid-js"

import { GenericTool } from "../basic-tool"
import { FileTool } from "./file-tool"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import "./edit-tool.css"

function EditTool(props: ToolRendererProps): JSX.Element {
  const input = () => {
    const path = props.tool.input.path
    const oldString = props.tool.input.oldString
    const newString = props.tool.input.newString
    if (typeof path !== "string" || path.length === 0 || typeof oldString !== "string" || typeof newString !== "string")
      return undefined
    return { path, oldString, newString, replaceAll: props.tool.input.replaceAll === true }
  }
  const replacements = () => {
    if (props.tool.state.type !== "succeeded") return undefined
    const result = props.tool.state.result
    if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined
    const value = Reflect.get(result, "replacements")
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
      ? value
      : undefined
  }
  const diff = () => {
    const files = props.tool.metadata.files
    if (!Array.isArray(files)) return undefined
    for (const file of files) {
      if (typeof file !== "object" || file === null || Array.isArray(file)) continue
      const path = Reflect.get(file, "file")
      const patch = Reflect.get(file, "patch")
      const additions = Reflect.get(file, "additions")
      const deletions = Reflect.get(file, "deletions")
      const status = Reflect.get(file, "status")
      if (typeof path !== "string" || path.length === 0 || typeof patch !== "string") continue
      if (status !== "added" && status !== "deleted" && status !== "modified") continue
      if (
        typeof additions !== "number" ||
        !Number.isFinite(additions) ||
        !Number.isInteger(additions) ||
        additions < 0 ||
        typeof deletions !== "number" ||
        !Number.isFinite(deletions) ||
        !Number.isInteger(deletions) ||
        deletions < 0
      )
        continue
      return { path, patch, additions, deletions }
    }
    return undefined
  }
  const diagnostics = () => {
    const path = diff()?.path ?? input()?.path
    const byFile = props.tool.metadata.diagnostics
    if (!path || typeof byFile !== "object" || byFile === null || Array.isArray(byFile)) return []
    const entries = Reflect.get(byFile, path)
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
        <div data-component="edit-tool">
          <FileTool
            type="edit"
            path={diff()?.path ?? value.path}
            status={props.tool.state.type === "failed" ? "stopped" : props.tool.state.type}
            openFile={() => props.actions.openFile(diff()?.path ?? value.path)}
            open={props.open}
            onOpenChange={props.onOpenChange}
            onContentRendered={props.onContentRendered}
          >
            <Show when={value.replaceAll}>
              <p data-slot="edit-tool-context">
                {replacements() === undefined
                  ? "Replace all occurrences; the preview shows the replacement pattern once."
                  : `${replacements()} replacement${replacements() === 1 ? "" : "s"}; the preview shows the replacement pattern once.`}
              </p>
            </Show>
            <Show
              when={diff()}
              fallback={
                <div data-slot="edit-tool-diff" role="group" aria-label="Content changes">
                  <pre data-change-kind="delete" role="region" aria-label="Old content">
                    {value.oldString}
                  </pre>
                  <pre data-change-kind="add" role="region" aria-label="New content">
                    {value.newString}
                  </pre>
                </div>
              }
            >
              {(change) => (
                <div data-slot="edit-tool-diff" role="group" aria-label="Content changes">
                  <div
                    data-slot="edit-tool-diff-summary"
                    aria-label={`${change().additions} additions and ${change().deletions} deletions`}
                  >
                    +{change().additions} -{change().deletions}
                  </div>
                  <pre role="region" aria-label={`Diff for ${change().path}`}>
                    <For each={change().patch.split("\n")}>
                      {(line) => (
                        <span>
                          {line}
                          {"\n"}
                        </span>
                      )}
                    </For>
                  </pre>
                </div>
              )}
            </Show>
            <Show when={diagnostics().length > 0}>
              <div data-slot="edit-tool-diagnostics" role="list" aria-label="Edit errors">
                <For each={diagnostics()}>
                  {(diagnostic) => (
                    <div data-slot="edit-tool-diagnostic" role="listitem">
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

ToolRegistry.register({ name: "edit", render: EditTool })
