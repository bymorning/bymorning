import { For, Show } from "solid-js"
import { useFile } from "@/workspaces/files/model.js"
import "./file-browser.css"

/** Project directory browser and the selected plain-text file editor. */
export function FileBrowser() {
  const file = useFile()
  return (
    <section aria-label="Project files" data-component="file-browser">
      <h2>Project files</h2>
      <label>
        Find file
        <input
          value={file.filter()}
          disabled={!file.connected()}
          onInput={(event) => file.setFilter(event.currentTarget.value)}
        />
      </label>
      <Show when={!file.connected()}>
        <p role="status">Reconnect to browse files.</p>
      </Show>
      <Show when={file.directory.isPending}>
        <p role="status">Loading files…</p>
      </Show>
      <Show when={file.directory.isError}>
        <div role="alert">
          Could not load files: {message(file.directory.error)}.{" "}
          <button onClick={() => void file.directory.refetch()}>Retry</button>
        </div>
      </Show>
      <nav aria-label="Project file list">
        <For each={file.filtered()}>
          {(path) => (
            <button
              type="button"
              disabled={!file.connected()}
              aria-pressed={file.selected() === path}
              data-selected={file.selected() === path ? "" : undefined}
              onClick={() => file.select(path)}
            >
              {path}
            </button>
          )}
        </For>
      </nav>
      <Show when={file.selected()}>
        <section aria-label="File content">
          <h3>File content</h3>
          <Show when={file.content.isPending}>
            <p role="status">Loading file…</p>
          </Show>
          <Show when={file.content.isError}>
            <div role="alert">
              Could not load this file: {message(file.content.error)}.{" "}
              <button onClick={() => void file.content.refetch()}>Retry</button>
            </div>
          </Show>
          <Show when={!file.content.isPending && !file.content.isError && file.text() === undefined}>
            <p role="status">This binary file cannot be edited.</p>
          </Show>
          <Show when={file.text() !== undefined}>
            <textarea
              aria-label="File content"
              value={file.draft() ?? ""}
              onInput={(event) => file.setDraft(event.currentTarget.value)}
            />
            <button type="button" disabled={!file.connected() || file.writeState().pending} onClick={file.save}>
              Save file
            </button>
          </Show>
          <Show when={file.writeState().error}>
            {(error) => <p role="alert">Could not save this file: {message(error())}.</p>}
          </Show>
        </section>
      </Show>
    </section>
  )
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
