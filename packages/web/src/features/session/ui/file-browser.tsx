import { Match, Show, Switch, createEffect, on, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Button } from "../../../ui/components/button"
import { FileViewer } from "../../../ui/components/file-viewer"
import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import { Spinner } from "../../../ui/components/spinner"
import type { ProjectFileController } from "../project-file-controller"
import { ProjectFileSidebar } from "./project-file-sidebar"
import "./file-browser.css"

export function FileBrowser(props: {
  readonly open: boolean
  readonly model: ProjectFileController
  /** Whether the file tree starts shown; later toggles are reported through `onTreeChange`. */
  readonly tree?: boolean | undefined
  readonly onTreeChange?: ((shown: boolean) => void) | undefined
  readonly children: (view: { readonly actions: JSX.Element; readonly content: JSX.Element }) => JSX.Element
}): JSX.Element {
  const [state, setState] = createStore({ mobilePreview: false, treeOpen: props.tree ?? false, animating: false })
  let filterInput!: HTMLInputElement
  let backButton!: HTMLButtonElement
  let sidebar!: HTMLElement
  const mobile = () => window.matchMedia("(max-width: 916px)").matches
  const previewError = () => {
    const preview = props.model.preview()
    return preview.state === "error" ? preview.message : undefined
  }
  const readyFile = () => {
    const preview = props.model.preview()
    return preview.state === "ready" ? preview.file : undefined
  }

  const focus = () => {
    if (mobile() && state.mobilePreview && props.model.activePath()) {
      backButton.focus({ preventScroll: true })
    } else if (mobile() || state.treeOpen) {
      filterInput.focus({ preventScroll: true })
    }
  }
  createEffect(
    on([() => props.open, props.model.activePath], ([open, path]) => {
      if (!open) return
      setState("mobilePreview", path !== undefined)
    }),
  )

  return props.children({
    actions: (
      <IconButton
        type="button"
        size="large"
        variant="ghost-muted"
        state={state.treeOpen ? "pressed" : "rest"}
        data-slot="file-browser-tree-toggle"
        aria-label={state.treeOpen ? "Hide file tree" : "Show file tree"}
        aria-pressed={state.treeOpen}
        onClick={() => {
          const next = !state.treeOpen
          setState({ treeOpen: next, animating: true })
          props.onTreeChange?.(next)
          if (next) queueMicrotask(() => filterInput.focus({ preventScroll: true }))
        }}
        icon={<Icon name="filetree" />}
      />
    ),
    content: (
      <div
        data-component="file-browser"
        data-tree-open={state.treeOpen ? "" : undefined}
        data-animating={state.animating ? "" : undefined}
        data-mobile-preview={state.mobilePreview && props.model.activePath() ? "" : undefined}
      >
        <div
          ref={(element) => (sidebar = element)}
          data-slot="file-browser-sidebar"
          onTransitionEnd={(event) => {
            if (event.target === sidebar && event.propertyName === "width") setState("animating", false)
          }}
        >
          <ProjectFileSidebar
            model={props.model}
            filterRef={(element) => (filterInput = element)}
            onSelect={(path) => {
              props.model.select(path)
              setState("mobilePreview", true)
              if (mobile()) queueMicrotask(focus)
            }}
          />
        </div>
        <section data-slot="file-browser-preview" aria-label="File preview">
          <div data-slot="file-browser-preview-header">
            <Button
              ref={(element: HTMLButtonElement) => (backButton = element)}
              type="button"
              size="small"
              variant="ghost"
              data-slot="file-browser-preview-back"
              icon="arrow-left"
              onClick={() => {
                setState("mobilePreview", false)
                filterInput.focus({ preventScroll: true })
              }}
            >
              Back to files
            </Button>
            <span data-slot="file-browser-preview-title" title={props.model.activePath()}>
              {props.model.activePath() ?? "Preview"}
            </span>
            <Show when={props.model.activePath()}>
              {(path) => (
                <IconButton
                  type="button"
                  size="large"
                  variant="ghost-muted"
                  data-slot="file-browser-preview-download"
                  aria-label={`Download ${path().split("/").at(-1)}`}
                  title="Download"
                  onClick={() => void props.model.download(path())}
                  icon={<Icon name="download" />}
                />
              )}
            </Show>
          </div>
          <div data-slot="file-browser-preview-content">
            <Switch>
              <Match when={props.model.preview().state === "empty"}>
                <div data-slot="file-browser-preview-state" data-layout="centered">
                  <Icon name="filetree" size="large" />
                  <p data-slot="file-browser-preview-state-text">Select a file to preview.</p>
                </div>
              </Match>
              <Match when={props.model.preview().state === "loading"}>
                <div data-slot="file-browser-preview-state" data-layout="centered" role="status">
                  <Spinner size={32} />
                  <p data-slot="file-browser-preview-state-text">Loading file…</p>
                </div>
              </Match>
              <Match when={previewError()}>
                <div data-slot="file-browser-preview-state" data-layout="centered" role="alert">
                  <p data-slot="file-browser-preview-state-text">{previewError()}</p>
                  <Button
                    data-slot="file-browser-preview-state-action"
                    type="button"
                    variant="outline"
                    onClick={props.model.reload}
                  >
                    Reload
                  </Button>
                </div>
              </Match>
              <Match when={readyFile()}>
                <Show when={readyFile()}>{(file) => <FileViewer file={file()} />}</Show>
              </Match>
            </Switch>
          </div>
        </section>
      </div>
    ),
  })
}
