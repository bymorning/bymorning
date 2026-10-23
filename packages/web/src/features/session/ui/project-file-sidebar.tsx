import { Match, Show, Switch, type JSX } from "solid-js"

import { useDialog } from "../../../context/dialog"
import { ActionMenu } from "../../../ui/components/action-menu"
import { Button } from "../../../ui/components/button"
import { FileTree } from "../../../ui/components/file-tree"
import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import type { ProjectFileController } from "../project-file-controller"
import { DeleteDialog, RenameDialog } from "./project-file-dialogs"
import "./project-file-sidebar.css"

export interface ProjectFileSidebarProps {
  readonly model: ProjectFileController
  readonly filterRef: (element: HTMLInputElement) => void
  readonly onSelect: (path: string) => void
}

export function ProjectFileSidebar(props: ProjectFileSidebarProps): JSX.Element {
  const listError = () => {
    const state = props.model.list()
    return state.state === "error" ? state.message : undefined
  }
  const readyPaths = () => {
    const state = props.model.list()
    return state.state === "ready" ? state.paths : undefined
  }

  const dialog = useDialog()
  const rename = (kind: "file" | "folder", path: string) =>
    dialog.show(() => (
      <RenameDialog
        kind={kind}
        path={path}
        onSubmit={(to) => (kind === "file" ? props.model.move(path, to) : props.model.moveFolder(path, to))}
      />
    ))
  const remove = (kind: "file" | "folder", path: string) => {
    // Count before confirming so the dialog names exactly what it deletes.
    const count = kind === "folder" ? props.model.filesIn(path).length : 1
    dialog.show(() => (
      <DeleteDialog
        kind={kind}
        path={path}
        count={count}
        onConfirm={() => (kind === "file" ? props.model.remove(path) : props.model.removeFolder(path))}
      />
    ))
  }

  let picker!: HTMLInputElement
  const uploadTarget = () => props.model.folder() ?? "Project root"

  return (
    <div data-component="project-file-sidebar">
      <div data-slot="project-file-sidebar-filter">
        <Icon name="magnifying-glass" />
        <input
          ref={props.filterRef}
          type="search"
          data-slot="project-file-sidebar-filter-input"
          aria-label="Filter project files"
          placeholder="Filter files…"
          value={props.model.filter()}
          onInput={(event) => props.model.setFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !props.model.filter()) return
            event.preventDefault()
            props.model.setFilter("")
          }}
        />
        <Show when={props.model.filter()}>
          <IconButton
            type="button"
            size="large"
            variant="ghost-muted"
            data-slot="project-file-sidebar-filter-clear"
            aria-label="Clear file filter"
            onClick={() => props.model.setFilter("")}
            icon={<Icon name="xmark-small" />}
          />
        </Show>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-slot="project-file-sidebar-upload-input"
          aria-label="Choose files to upload"
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ""
            void props.model.upload(files)
          }}
        />
        <IconButton
          type="button"
          size="large"
          variant="ghost-muted"
          data-slot="project-file-sidebar-upload"
          aria-label="Upload files"
          title={`Upload files to ${uploadTarget()}`}
          disabled={props.model.list().state !== "ready" || props.model.uploading()}
          onClick={() => picker.click()}
          icon={<Icon name="upload" />}
        />
      </div>

      <Show when={props.model.folder()}>
        {(folder) => (
          <div data-slot="project-file-sidebar-target">
            <span title={folder()}>Uploads go to {folder()}/</span>
            <Button
              type="button"
              size="small"
              variant="ghost"
              data-slot="project-file-sidebar-target-clear"
              onClick={() => props.model.selectFolder(undefined)}
            >
              Use root
            </Button>
          </div>
        )}
      </Show>

      <nav data-slot="project-file-sidebar-navigation" aria-label="Project file navigation">
        <Switch>
          <Match when={props.model.list().state === "idle"}>
            <p data-slot="project-file-sidebar-state" role="status">
              Waiting for Project files…
            </p>
          </Match>
          <Match when={props.model.list().state === "loading"}>
            <p data-slot="project-file-sidebar-state" role="status">
              Loading Project files…
            </p>
          </Match>
          <Match when={listError()}>
            <div data-slot="project-file-sidebar-state" data-layout="centered" role="alert">
              <p data-slot="project-file-sidebar-state-text">{listError()}</p>
              <Button
                data-slot="project-file-sidebar-state-action"
                type="button"
                variant="outline"
                onClick={props.model.reload}
              >
                Retry
              </Button>
            </div>
          </Match>
          <Match when={readyPaths()}>
            <Show
              when={readyPaths()!.length > 0}
              fallback={<p data-slot="project-file-sidebar-state">This Project has no files.</p>}
            >
              <Show
                when={props.model.visiblePaths().length > 0}
                fallback={<p data-slot="project-file-sidebar-state">No files match this filter.</p>}
              >
                <FileTree
                  paths={props.model.visiblePaths()}
                  {...(props.model.activePath() ? { activePath: props.model.activePath() } : {})}
                  onSelect={props.onSelect}
                  selectedDirectory={props.model.folder()}
                  onSelectDirectory={props.model.selectFolder}
                  rowActions={(node) =>
                    node.type === "file" ? (
                      <ActionMenu label={node.path} triggerLabel={`Actions for ${node.path}`}>
                        <ActionMenu.Item onSelect={() => void props.model.download(node.path)}>
                          Download
                        </ActionMenu.Item>
                        <ActionMenu.Item onSelect={() => rename("file", node.path)}>Rename…</ActionMenu.Item>
                        <ActionMenu.Separator />
                        <ActionMenu.Item class="danger" onSelect={() => remove("file", node.path)}>
                          Delete…
                        </ActionMenu.Item>
                      </ActionMenu>
                    ) : (
                      <ActionMenu label={node.path} triggerLabel={`Actions for folder ${node.path}`}>
                        <ActionMenu.Item onSelect={() => rename("folder", node.path)}>Rename folder…</ActionMenu.Item>
                        <ActionMenu.Separator />
                        <ActionMenu.Item class="danger" onSelect={() => remove("folder", node.path)}>
                          Delete folder…
                        </ActionMenu.Item>
                      </ActionMenu>
                    )
                  }
                />
              </Show>
            </Show>
          </Match>
        </Switch>
      </nav>
    </div>
  )
}
