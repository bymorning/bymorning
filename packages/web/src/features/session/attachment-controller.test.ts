/* oxlint-disable typescript/no-unsafe-type-assertion -- FileList construction is unavailable in jsdom. */
import { Project } from "@bymorning/schema/project"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"

import { createAttachmentController as createController } from "./attachment-controller"
import { directoryFixture } from "../../test/directory"

function createAttachmentController(input: Pick<Parameters<typeof createController>[0], "scope" | "write">) {
  const directory = directoryFixture()
  return createController({ ...input, server: directory.scope, query: directory.query })
}

const fileList = (file: File) =>
  Object.assign([file], { item: (index: number) => (index === 0 ? file : null) }) as FileList

describe("attachment controller", () => {
  it("uploads immediately with the selected Project and projects ready and error states", async () => {
    const projectID = Project.ID.create()
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"))
    const { attachments, dispose } = createRoot((dispose) => ({
      attachments: createAttachmentController({ scope: () => projectID, write }),
      dispose,
    }))
    const ready = new File(["ready"], "ready.txt")
    const failed = new File(["failed"], "failed.bin")

    attachments.add(fileList(ready))
    attachments.add(fileList(failed))
    expect(attachments.items().map((item) => item.state)).toEqual(["uploading", "uploading"])
    await vi.waitFor(() => expect(attachments.items().map((item) => item.state)).toEqual(["ready", "error"]))
    expect(write).toHaveBeenNthCalledWith(1, projectID, "ready.txt", "application/octet-stream", ready)
    expect(write).toHaveBeenNthCalledWith(2, projectID, "failed.bin", "application/octet-stream", failed)
    dispose()
  })

  it("disables without scope and ignores stale completion after scope changes", async () => {
    const first = Project.ID.create()
    const second = Project.ID.create()
    const [scope, setScope] = createSignal<Project.ID | undefined>()
    const pending = Promise.withResolvers<void>()
    const write = vi.fn(() => pending.promise)
    const { attachments, dispose } = createRoot((dispose) => ({
      attachments: createAttachmentController({ scope, write }),
      dispose,
    }))

    attachments.add(fileList(new File(["ignored"], "ignored.txt")))
    expect(attachments.disabled()).toBe(true)
    expect(write).not.toHaveBeenCalled()
    setScope(first)
    attachments.add(fileList(new File(["pending"], "pending.txt")))
    expect(attachments.items()[0]?.state).toBe("uploading")
    setScope(second)
    expect(attachments.items()).toEqual([])
    pending.resolve()
    await pending.promise
    await Promise.resolve()
    expect(attachments.items()).toEqual([])
    dispose()
  })

  it("retains native execution state until dismissal and releases only its own mutations", async () => {
    const projectID = Project.ID.create()
    const mounted = createRoot((dispose) => {
      const directory = directoryFixture()
      const attachments = createController({
        scope: () => projectID,
        server: directory.scope,
        query: directory.query,
        write: async () => undefined,
      })
      return { attachments, query: directory.query, dispose }
    })
    mounted.attachments.add(fileList(new File(["ready"], "ready.txt")))
    await vi.waitFor(() => expect(mounted.attachments.items()[0]?.state).toBe("ready"))
    const cache = mounted.query.getMutationCache()
    expect(cache.getAll()).toHaveLength(1)
    expect(cache.getAll()[0]?.options.gcTime).toBe(Infinity)
    mounted.attachments.remove(mounted.attachments.items()[0]!.id)
    expect(cache.getAll()).toHaveLength(0)
    mounted.dispose()
  })
})
