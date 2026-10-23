import type { Project } from "@bymorning/schema/project"
import { createResource, For, Match, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useEntry } from "../context/dialog"
import { Button } from "../ui/components/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "../ui/components/dialog"
import { formatMediumDate } from "../ui/format"
import { errorMessage } from "../utils/error-message"
import { projectName } from "./archive"
import "./restore-dialog.css"

/** Lists archived Projects with a Restore action each; restoring one closes the dialog. */
export function RestoreProjectDialog(props: {
  readonly list: () => Promise<ReadonlyArray<Project.Info>>
  readonly restore: (project: Project.Info) => Promise<unknown>
  /** Return to the Create project form. */
  readonly back: () => void
}): JSX.Element {
  const entry = useEntry()
  const [projects, actions] = createResource(() => props.list())
  const [state, setState] = createStore<{ pending: Project.ID | undefined; error: string | undefined }>({
    pending: undefined,
    error: undefined,
  })
  entry.guard(() => state.pending !== undefined)
  const restore = async (project: Project.Info) => {
    if (state.pending !== undefined) return
    setState({ pending: project.id, error: undefined })
    try {
      await props.restore(project)
      setState("pending", undefined)
      entry.close()
    } catch (cause) {
      setState({ pending: undefined, error: errorMessage(cause, "Project could not be restored.") })
    }
  }
  return (
    <Dialog
      fit
      variant="card"
      data-component="restore-project-dialog"
      aria-label="Restore an archived project"
      aria-busy={state.pending !== undefined}
    >
      <DialogHeader hideClose={state.pending !== undefined}>
        <DialogTitleGroup
          title="Restore an archived project"
          description="Restoring brings back the project and its sessions as they were."
        />
      </DialogHeader>
      <DialogBody>
        <Switch>
          <Match when={projects.loading}>
            <p data-slot="restore-project-status" role="status">
              Loading archived projects…
            </p>
          </Match>
          <Match when={projects.error !== undefined}>
            <div data-slot="restore-project-status" role="alert">
              <span>Archived projects could not be loaded.</span>
              <Button variant="outline" size="small" onClick={() => void actions.refetch()}>
                Retry
              </Button>
            </div>
          </Match>
          <Match when={projects()?.length === 0}>
            <div data-slot="restore-project-empty">
              <p>No archived projects</p>
              <p>Projects you archive appear here so you can restore them.</p>
            </div>
          </Match>
          <Match when={projects()}>
            {(list) => (
              <ul data-slot="restore-project-list" aria-label="Archived projects">
                <For each={list()}>
                  {(project) => (
                    <li data-slot="restore-project-item">
                      <div data-slot="restore-project-text">
                        <span data-slot="restore-project-name">{projectName(project)}</span>
                        <span data-slot="restore-project-date">
                          {project.archivedAt ? `Archived ${formatMediumDate(project.archivedAt)}` : "Archived"}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="small"
                        aria-label={`Restore ${projectName(project)}`}
                        disabled={state.pending !== undefined}
                        onClick={() => void restore(project)}
                      >
                        {state.pending === project.id ? "Restoring…" : "Restore"}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
        </Switch>
      </DialogBody>
      <Switch>
        <Match when={state.error}>
          {(message) => (
            <p role="alert" data-slot="restore-project-error">
              {message()}
            </p>
          )}
        </Match>
      </Switch>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="large"
          disabled={state.pending !== undefined}
          onClick={() => props.back()}
        >
          Back
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
