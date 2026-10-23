import type { Project } from "@bymorning/schema/project"
import { createComponent, createResource, type Accessor, type JSX } from "solid-js"

import type { ServerSync } from "../runtime/server/sync"
import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"

const ARCHIVE_TOAST_MS = 12_000

/** Shown wherever the Default Project's archive action would be. */
export const defaultProjectReason = "The Default project can't be archived."

/** A Project's display name. */
export const projectName = (project: Pick<Project.Info, "name">) => project.name ?? "Untitled"

/**
 * Archive or restore a Project, then refresh the Project and Session lists: the server hides an archived
 * Project's Sessions from the Session inventory and returns them on restore.
 */
export async function setProjectArchived(server: ServerSync, projectID: Project.ID, archived: boolean) {
  const project = await server.scope.api.project.update({ workspace: server.scope.workspace, projectID, archived })
  server.data.project.invalidate()
  server.data.session.invalidate()
  await Promise.all([server.data.project.sync(), server.data.session.sync()])
  return project
}

/**
 * The archived Project a route or Session refers to. Active Projects are in the shared Project list; any other
 * Project is fetched once the list is ready, so an archived one is still recognized when visited directly.
 */
export function createArchivedProject(server: ServerSync, projectID: Accessor<Project.ID | undefined>) {
  const unknown = () => {
    const id = projectID()
    return id !== undefined && server.bootstrapState().state === "ready" && !server.data.project.get(id)
      ? id
      : undefined
  }
  const [fetched] = createResource(unknown, (id) =>
    server.scope.api.project.get({ workspace: server.scope.workspace, projectID: id }).catch(() => undefined),
  )
  return {
    project: (): Project.Info | undefined => {
      const id = unknown()
      if (id === undefined) return undefined
      const current = fetched.state === "ready" ? fetched() : undefined
      return current?.id === id && current.archivedAt !== undefined ? current : undefined
    },
    loading: () => unknown() !== undefined && fetched.loading,
  }
}

/**
 * Ask first, then archive a Project, leave it for the Overview, and confirm with an Undo toast.
 * Resolves true once archived and false when the user dismisses the confirmation.
 */
export function archiveProject(input: {
  readonly server: ServerSync
  readonly dialog: { show(element: () => JSX.Element, onClose?: () => void): void }
  readonly project: Project.Info
  readonly leave: () => void
}): Promise<boolean> {
  return new Promise((resolve) => {
    let archived = false
    const name = projectName(input.project)
    input.dialog.show(
      () =>
        createComponent(ConfirmDialog, {
          title: `Archive ${name}?`,
          description:
            "It will be hidden with its sessions and become read-only. You can restore it from Create project.",
          confirmLabel: "Archive project",
          async onConfirm() {
            await setProjectArchived(input.server, input.project.id, true)
            archived = true
            input.leave()
            showToast({
              variant: "success",
              title: "Project archived",
              description: name,
              // Undo is the quickest way back, so keep it available well beyond the default.
              duration: ARCHIVE_TOAST_MS,
              actions: [
                {
                  label: "Undo",
                  onClick: () =>
                    void setProjectArchived(input.server, input.project.id, false).catch((cause: unknown) =>
                      showToast({ variant: "error", title: errorMessage(cause, "Could not restore project") }),
                    ),
                },
              ],
            })
          },
        }),
      () => resolve(archived),
    )
  })
}
