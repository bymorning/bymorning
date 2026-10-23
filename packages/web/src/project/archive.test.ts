import { Project } from "@bymorning/schema/project"
import { createRoot } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import type { ServerSync } from "../runtime/server/sync"

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock("../ui/components/toast", () => ({ showToast }))
vi.mock("../ui/components/confirm-dialog", () => ({ ConfirmDialog: (props: unknown) => props }))

import { archiveProject, createArchivedProject, setProjectArchived } from "./archive"

afterEach(() => showToast.mockReset())

const project = Project.Info.make({ id: Project.ID.create(), name: "Launch", time_created: 1, time_updated: 1 })

function fakeServer(input: { readonly active?: ReadonlyArray<Project.Info>; readonly fetched?: Project.Info } = {}) {
  const calls: string[] = []
  const update = vi.fn(async (request: { readonly projectID: Project.ID; readonly archived?: boolean }) => {
    calls.push(`update:${request.archived}`)
    return { ...project, ...(request.archived ? { archivedAt: new Date("2026-10-01T00:00:00.000Z") } : {}) }
  })
  const get = vi.fn(async () => input.fetched ?? project)
  const server = {
    scope: { workspace: "wrk_test", api: { project: { update, get } } },
    bootstrapState: () => ({ state: "ready" }),
    data: {
      project: {
        get: (id: Project.ID) => input.active?.find((item) => item.id === id),
        invalidate: () => calls.push("project:invalidate"),
        sync: async () => void calls.push("project:sync"),
      },
      session: {
        invalidate: () => calls.push("session:invalidate"),
        sync: async () => void calls.push("session:sync"),
      },
    },
  } as unknown as ServerSync
  return { server, update, get, calls }
}

it("re-reads the Project and Session lists after archiving or restoring, since both change", async () => {
  const { server, update, calls } = fakeServer()
  await setProjectArchived(server, project.id, true)
  expect(update).toHaveBeenCalledWith({ workspace: "wrk_test", projectID: project.id, archived: true })
  expect(calls).toEqual(["update:true", "project:invalidate", "session:invalidate", "project:sync", "session:sync"])
})

it("asks first, archives, leaves for the Overview, and offers Undo that restores the Project", async () => {
  const { server, update } = fakeServer()
  const leave = vi.fn()
  let element: (() => unknown) | undefined
  let close: (() => void) | undefined
  const done = archiveProject({
    server,
    dialog: {
      show: (next, onClose) => {
        element = next
        close = onClose
      },
    },
    project,
    leave,
  })
  const confirm = element?.() as {
    title: string
    description: string
    confirmLabel: string
    onConfirm: () => Promise<void>
  }
  expect(confirm.title).toBe("Archive Launch?")
  expect(confirm.description).toBe(
    "It will be hidden with its sessions and become read-only. You can restore it from Create project.",
  )
  expect(confirm.confirmLabel).toBe("Archive project")
  expect(update).not.toHaveBeenCalled()

  await confirm.onConfirm()
  close?.()
  expect(await done).toBe(true)
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ projectID: project.id, archived: true }))
  expect(leave).toHaveBeenCalledTimes(1)
  const toast = showToast.mock.calls[0]?.[0]
  expect(toast).toMatchObject({ variant: "success", title: "Project archived", description: "Launch" })
  expect(toast.duration).toBeGreaterThanOrEqual(10_000)

  toast.actions[0].onClick()
  await vi.waitFor(() =>
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ projectID: project.id, archived: false })),
  )
})

it("does not archive or leave when the confirmation is dismissed", async () => {
  const { server, update } = fakeServer()
  const leave = vi.fn()
  let close: (() => void) | undefined
  const done = archiveProject({ server, dialog: { show: (_next, onClose) => (close = onClose) }, project, leave })
  close?.()
  expect(await done).toBe(false)
  expect(update).not.toHaveBeenCalled()
  expect(leave).not.toHaveBeenCalled()
})

it("recognizes an archived Project that is absent from the active list, and ignores active ones", async () => {
  const archived = { ...project, archivedAt: new Date("2026-10-01T00:00:00.000Z") }
  const missing = fakeServer({ fetched: archived })
  await createRoot(async (dispose) => {
    const state = createArchivedProject(missing.server, () => project.id)
    await vi.waitFor(() => expect(state.project()).toEqual(archived))
    dispose()
  })

  const active = fakeServer({ active: [project], fetched: archived })
  createRoot((dispose) => {
    const state = createArchivedProject(active.server, () => project.id)
    expect(state.project()).toBeUndefined()
    expect(state.loading()).toBe(false)
    dispose()
  })
  expect(active.get).not.toHaveBeenCalled()
})
