import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"

import { FileIcon } from "../../ui/components/file-icon"
import { TextInput } from "../../ui/components/text-input"
import type { ProjectFileListState } from "./project-file-list-model"
import "./project-file-list.css"

export function ProjectFileList(props: {
  readonly state: ProjectFileListState
  readonly onOpen: (path: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const readyCount = () =>
    props.state.status === "ready" ? props.state.items.length : props.state.status === "empty" ? 0 : undefined
  const filter = <Item extends { readonly path: string }>(items: ReadonlyArray<Item>) => {
    const normalized = query().trim().toLocaleLowerCase()
    return normalized ? items.filter((item) => item.path.toLocaleLowerCase().includes(normalized)) : items
  }
  const examples = createMemo(() => filter(exampleFiles))
  return (
    <div data-component="project-file-list">
      <div data-slot="project-file-list-heading">
        <div>
          <h2 id="project-files-heading">Files</h2>
          <Show when={readyCount() !== undefined}>
            <p>
              {readyCount()} {readyCount() === 1 ? "file" : "files"}
            </p>
          </Show>
        </div>
        <label>
          <span class="sr-only">Search project files</span>
          <TextInput
            type="search"
            appearance="full-width"
            value={query()}
            placeholder="Search project files…"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>
      <Switch>
        <Match when={props.state.status === "no-project"}>
          <p data-slot="project-file-list-message">Select a project to view its files.</p>
        </Match>
        <Match when={props.state.status === "loading"}>
          <p data-slot="project-file-list-loading" role="status">
            Loading project files…
          </p>
        </Match>
        <Match when={props.state.status === "error" ? props.state : undefined}>
          {(state) => (
            <>
              <p data-slot="project-file-list-message" data-error role="alert">
                {state().message}
              </p>
              <p data-slot="project-file-list-context">
                Showing example files while the project directory is unavailable.
              </p>
              <FileTable items={examples()} examples onOpen={props.onOpen} />
            </>
          )}
        </Match>
        <Match when={props.state.status === "empty"}>
          <FileTable items={examples()} examples onOpen={props.onOpen} />
        </Match>
        <Match when={props.state.status === "ready" ? props.state : undefined}>
          {(state) => <FileTable items={filter(state().items)} onOpen={props.onOpen} />}
        </Match>
      </Switch>
    </div>
  )
}

const exampleFiles = [{ path: "README.md" }, { path: "package.json" }, { path: "src/index.ts" }] as const

function FileTable(props: {
  readonly items: ReadonlyArray<{ readonly path: string }>
  readonly examples?: boolean
  readonly onOpen: (path: string) => void
}) {
  const [scroll, setScroll] = createSignal<HTMLDivElement>()
  const [focusedPath, setFocusedPath] = createSignal<string>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    get count() {
      return props.items.length
    },
    getScrollElement: () => scroll() ?? null,
    observeElementOffset: (instance, callback) => {
      const element = instance.scrollElement
      if (!element) return
      const update = () => callback(element.scrollTop, false)
      element.addEventListener("scroll", update, { passive: true })
      update()
      return () => element.removeEventListener("scroll", update)
    },
    initialRect: { width: 0, height: 480 },
    estimateSize: () => 28,
    overscan: 10,
    get getItemKey() {
      const items = props.items
      return (index: number) => items[index]?.path ?? index
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const path = focusedPath()
      const index = path ? props.items.findIndex((item) => item.path === path) : -1
      if (index < 0 || indexes.includes(index)) return indexes
      return [...indexes, index].sort((left, right) => left - right)
    },
  })
  const virtualItems = createMemo(() => virtualizer.getVirtualItems())
  const virtualItemByKey = createMemo(() => new Map(virtualItems().map((item) => [item.key, item])))
  const virtualKeys = createMemo(() => virtualItems().map((item) => item.key))

  return (
    <div
      ref={setScroll}
      data-slot="project-file-table-scroll"
      role="region"
      aria-label={props.examples ? "Example files table" : "Project files table"}
      tabindex="0"
    >
      <table
        data-slot="project-file-table"
        data-examples={props.examples ? "" : undefined}
        data-total-rows={props.items.length}
        aria-rowcount={props.items.length + 1}
      >
        <caption>{props.examples ? "Example project files" : "Files in the selected project"}</caption>
        <thead>
          <tr>
            <th scope="col">Path</th>
          </tr>
        </thead>
        <tbody>
          <For each={virtualKeys()}>
            {(key, position) => {
              const item = createMemo(() => virtualItemByKey().get(key))
              const path = () => props.items[item()?.index ?? -1]?.path
              const spacer = () => (item() && path() ? item()!.start - (virtualItems()[position() - 1]?.end ?? 0) : 0)
              return (
                <Show when={item() && path()}>
                  <Show when={spacer() > 0}>
                    <tr data-slot="project-file-table-spacer" aria-hidden="true">
                      <td style={{ height: `${spacer()}px` }} />
                    </tr>
                  </Show>
                  <tr data-path={path()} aria-rowindex={(item()?.index ?? -1) + 2}>
                    <td>
                      <span data-slot="project-file-table-name">
                        <FileIcon node={{ path: path()!, type: "file" }} aria-hidden="true" />
                        {props.examples ? (
                          <span title={path()}>{path()}</span>
                        ) : (
                          <button
                            type="button"
                            data-slot="project-file-table-open"
                            title={path()}
                            onFocus={() => setFocusedPath(path()!)}
                            onBlur={() => {
                              queueMicrotask(() => {
                                const active = scroll()?.ownerDocument.activeElement
                                if (active instanceof Element && scroll()?.contains(active)) return
                                setFocusedPath(undefined)
                              })
                            }}
                            onClick={() => props.onOpen(path()!)}
                          >
                            {path()}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                </Show>
              )
            }}
          </For>
          <Show when={virtualizer.getTotalSize() - (virtualItems().at(-1)?.end ?? 0) > 0}>
            <tr data-slot="project-file-table-spacer" aria-hidden="true">
              <td style={{ height: `${virtualizer.getTotalSize() - (virtualItems().at(-1)?.end ?? 0)}px` }} />
            </tr>
          </Show>
        </tbody>
      </table>
    </div>
  )
}
