/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixtures implement only the exercised session seam. */
import { Agent } from "@bymorning/schema/agent"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { QueryClient, useMutation } from "@tanstack/solid-query"

import { createPromptState } from "../../context/prompt-state"
import { directoryFixture } from "../../test/directory"
import { createController as createComposerController } from "./composer-controller"
import type { PromptSubmissionState } from "./prompt-submission-state"

const commands = () => ({
  register: vi.fn(),
  slash: { search: () => undefined, select: () => false },
})
const initialSelection = {
  agent: Agent.DefaultID,
  model: { provider: Provider.Bymorning, id: "model", variant: "fast" },
}

function createController(source: Parameters<typeof createComposerController>[0]) {
  const query = new QueryClient()
  const submit = useMutation(
    () => ({ mutationFn: (value: Parameters<typeof source.composer.submit>[0]) => source.composer.submit(value) }),
    () => query,
  )
  const cancel = useMutation(
    () => ({ mutationFn: source.composer.cancel }),
    () => query,
  )
  const compact = useMutation(
    () => ({ mutationFn: source.composer.compact }),
    () => query,
  )
  const background = useMutation(
    () => ({ mutationFn: source.composer.background }),
    () => query,
  )
  const mutations = [submit, cancel, compact, background]
  return createComposerController({
    ...source,
    projectDirectory: { ...source.projectDirectory, ...directoryFixture() },
    composer: {
      submit: submit.mutateAsync,
      cancel: cancel.mutateAsync,
      compact: compact.mutateAsync,
      background: background.mutateAsync,
      pending: () => mutations.some((mutation) => mutation.isPending),
      error: () => mutations.find((mutation) => mutation.error)?.error?.message,
    },
  })
}

describe("composer controller", () => {
  it("treats whitespace as blank while preserving attachment-only admission", async () => {
    const projectID = Project.ID.create()
    const submit = vi.fn(async ({ submission }: { readonly submission: PromptSubmissionState }) => {
      submission.clear()
      submission.complete()
    })
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: { projectID, ...initialSelection } }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "   \n" }),
        composer: { submit, cancel: vi.fn(), error: () => undefined },
        commands: commands(),
        projectDirectory: {
          list: () => [],
          search: vi.fn().mockResolvedValue([]),
          write: vi.fn().mockResolvedValue(undefined),
        },
        selectionVisibility: { agent: () => false, variant: () => false },
      } as never),
    )

    expect(controller.blank()).toBe(true)
    await controller.submit()
    expect(submit).not.toHaveBeenCalled()

    const files = [new File(["notes"], "notes.txt")]
    controller.attachments.add(Object.assign(files, { item: (index: number) => files[index] ?? null }) as FileList)
    await vi.waitFor(() => expect(controller.blank()).toBe(false))
    await controller.submit()
    expect(submit).toHaveBeenCalledWith({ text: "   \n\n@notes.txt", submission: expect.anything() })
  })

  it("searches the authoritative ready Session project identity at invocation time", async () => {
    const first = Project.ID.create()
    const second = Project.ID.create()
    const [detail, setDetail] = createSignal<{ state: string; data?: { projectID: Project.ID } }>({ state: "loading" })
    const search = vi.fn().mockResolvedValue(["src/main.ts"])
    const controller = createRoot(() =>
      createController({
        data: { draft: () => "", detail, transcript: () => ({ state: "ready", data: [] }) },
        prompt: createPromptState(),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search },
      } as never),
    )
    const signal = new AbortController().signal

    expect(controller.projectFiles.scope()).toBeUndefined()
    expect(await controller.projectFiles.search("src", signal)).toEqual([])
    expect(search).not.toHaveBeenCalled()
    setDetail({ state: "ready", data: { projectID: first } })
    expect(controller.projectFiles.scope()).toBe(first)
    await controller.projectFiles.search("src", signal)
    setDetail({ state: "ready", data: { projectID: second } })
    await controller.projectFiles.search("test", signal)
    expect(search).toHaveBeenNthCalledWith(1, first, "src", signal)
    expect(search).toHaveBeenNthCalledWith(2, second, "test", signal)
  })

  it("derives availability and active state from transcript activity and compaction", () => {
    const projectID = Project.ID.create()
    const [detail, setDetail] = createSignal<{ state: string; data?: { projectID: Project.ID } }>({ state: "loading" })
    const [transcript, setTranscript] = createSignal<{
      state: string
      data?: Array<{ message: { type: string; status?: string }; activity?: { state: string } }>
    }>({
      state: "ready",
      data: [],
    })
    const controller = createRoot(() =>
      createController({
        data: { draft: () => "draft", detail, transcript },
        prompt: createPromptState({ text: "draft" }),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    expect(controller.command()).toBeUndefined()
    setDetail({ state: "ready", data: { projectID } })
    expect(controller.command()).toBe("submit")
    for (const state of ["queued", "running", "cancelling"]) {
      setTranscript({ state: "ready", data: [{ message: { type: "pending-user" }, activity: { state } }] })
      expect(controller.command()).toBe("stop")
    }
    setTranscript({
      state: "ready",
      data: [
        { message: { type: "pending-user" }, activity: { state: "failed" } },
        { message: { type: "pending-user" }, activity: { state: "cancelled" } },
      ],
    })
    expect(controller.command()).toBe("submit")
    setTranscript({ state: "ready", data: [{ message: { type: "compaction", status: "running" } }] })
    expect(controller.command()).toBe("stop")
    setTranscript({ state: "ready", data: [{ message: { type: "compaction", status: "completed" } }] })
    expect(controller.command()).toBe("submit")
  })

  it("keeps Stop from transcript activity while Session status is still idle", () => {
    const projectID = Project.ID.create()
    const [running, setRunning] = createSignal(false)
    const [transcript, setTranscript] = createSignal<{
      state: string
      data?: Array<{ message: { type: string; status?: string }; activity?: { state: string } }>
    }>({
      state: "ready",
      data: [],
    })
    const controller = createRoot(() =>
      createController({
        data: { detail: () => ({ state: "ready", data: { projectID } }), transcript },
        running,
        prompt: createPromptState({ text: "draft" }),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    expect(controller.command()).toBe("submit")
    setTranscript({ state: "ready", data: [{ message: { type: "pending-user" }, activity: { state: "running" } }] })
    expect(controller.command()).toBe("stop")
    setRunning(true)
    expect(controller.command()).toBe("stop")
    setTranscript({ state: "ready", data: [] })
    expect(controller.command()).toBe("stop")
    setRunning(false)
    expect(controller.command()).toBe("submit")
  })

  it("offers no command while the Session is archived and again once restored", () => {
    const projectID = Project.ID.create()
    const [archived, setArchived] = createSignal(true)
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: { projectID } }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        archived,
        prompt: createPromptState({ text: "draft" }),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    expect(controller.command()).toBeUndefined()
    setArchived(false)
    expect(controller.command()).toBe("submit")
  })

  it("shows Stop as soon as submit is pending", async () => {
    const projectID = Project.ID.create()
    const admission = Promise.withResolvers<void>()
    const submit = vi.fn(() => admission.promise)
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({
            state: "ready",
            data: { projectID, agent: Agent.DefaultID, model: initialSelection.model },
          }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        running: () => false,
        prompt: createPromptState({ text: "Hello" }),
        composer: { edit: vi.fn(), submit, cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    expect(controller.command()).toBe("submit")
    const pending = controller.submit()
    expect(controller.pending()).toBe(true)
    expect(controller.command()).toBe("stop")
    admission.resolve()
    await pending
    expect(controller.command()).toBe("submit")
  })

  it("submits quoted ready Project File references and clears them after completion", async () => {
    const projectID = Project.ID.create()
    const submit = vi.fn(async ({ submission }: { readonly submission: PromptSubmissionState }) => {
      submission.clear()
      submission.complete()
    })
    const pending = Promise.withResolvers<void>()
    const write = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(pending.promise)
    const controller = createRoot(() =>
      createController({
        data: {
          draft: () => "Review these",
          detail: () => ({
            state: "ready",
            data: { projectID, agent: Agent.DefaultID, model: initialSelection.model },
          }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "Review these" }),
        composer: { edit: vi.fn(), submit, cancel: vi.fn() },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]), write },
      } as never),
    )
    const files = [
      new File(["content"], "my notes.txt", { type: "text/plain" }),
      new File(["failed"], "failed.txt"),
      new File(["pending"], "pending.txt"),
    ]
    controller.attachments.add(Object.assign(files, { item: (index: number) => files[index] ?? null }) as FileList)
    await vi.waitFor(() =>
      expect(controller.attachments.items().map((item) => item.state)).toEqual(["ready", "error", "uploading"]),
    )

    await controller.submit()
    expect(submit).toHaveBeenLastCalledWith({
      text: 'Review these\n@"my notes.txt"',
      submission: expect.anything(),
    })
    expect(controller.attachments.items().map((item) => item.state)).toEqual(["error", "uploading"])
    pending.resolve()
    await pending.promise
  })

  it("stops independently and reports transport failure", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("offline"))
    const controller = createRoot(() =>
      createController({
        data: {
          draft: () => "draft",
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "draft" }),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )
    await controller.stop()
    expect(cancel).toHaveBeenCalledOnce()
    expect(controller.error()).toBe("offline")
  })

  it("owns stop pending state and admits only one cancellation", async () => {
    let resolve!: () => void
    const cancel = vi.fn(() => new Promise<void>((done) => (resolve = done)))
    const controller = createRoot(() =>
      createController({
        data: {
          draft: () => "draft",
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "draft" }),
        composer: { edit: vi.fn(), submit: vi.fn(), cancel },
        commands: commands(),
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )
    const first = controller.stop()
    expect(controller.pending()).toBe(true)
    await controller.stop()
    expect(cancel).toHaveBeenCalledOnce()
    resolve()
    await first
    expect(controller.pending()).toBe(false)
  })

  it("registers compact and Escape interrupt actions", async () => {
    let options!: () => ReadonlyArray<{
      readonly id: string
      readonly slash?: string
      readonly disabled?: boolean
      readonly onSelect?: () => void
    }>
    const compact = vi.fn().mockResolvedValue(undefined)
    const cancel = vi.fn().mockResolvedValue(undefined)
    const register = vi.fn((_key, value) => (options = value))
    const slash = { search: () => undefined, select: () => false }
    const controller = createRoot(() =>
      createController({
        data: {
          draft: () => "keep me",
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({
            state: "ready",
            data: [
              { message: { type: "user" } },
              { message: { type: "pending-user" }, activity: { state: "running" } },
            ],
          }),
        },
        prompt: createPromptState({ text: "keep me" }),
        composer: { edit: vi.fn(), submit: vi.fn(), compact, cancel },
        commands: { register, slash },
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    expect(register).toHaveBeenCalledWith("session", expect.any(Function))
    expect(options()[0]).toMatchObject({ id: "session.compact", slash: "compact", disabled: false })
    expect(options()[1]).toMatchObject({
      id: "session.interrupt",
      keybind: "escape",
      disabled: false,
      hidden: true,
    })
    expect(controller.slashCommands).toBe(slash)
    options()[0]?.onSelect?.()
    await vi.waitFor(() => expect(compact).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.pending()).toBe(false))
    options()[1]?.onSelect?.()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("surfaces compaction admission failure without an unhandled command rejection", async () => {
    let options!: () => ReadonlyArray<{ readonly id: string; readonly onSelect?: () => void }>
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({ state: "ready", data: [{ message: { type: "user" } }] }),
        },
        prompt: createPromptState(),
        composer: {
          submit: vi.fn(),
          compact: vi.fn().mockRejectedValue(new Error("offline")),
          cancel: vi.fn(),
        },
        commands: {
          register: vi.fn((_key, value) => (options = value)),
          slash: { search: () => undefined, select: () => false },
        },
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    options()[0]?.onSelect?.()

    await vi.waitFor(() => expect(controller.error()).toBe("offline"))
    expect(controller.pending()).toBe(false)
  })

  it("disables compaction while queued and until new user context exists after a completed checkpoint", () => {
    let options!: () => ReadonlyArray<{ readonly id: string; readonly disabled?: boolean }>
    const [inbox, setInbox] = createSignal<{ state: string; data: Array<{ type: string }> }>({
      state: "ready",
      data: [],
    })
    const [transcript, setTranscript] = createSignal<{
      state: string
      data: Array<{ message: { type: string; status?: string } }>
    }>({ state: "ready", data: [{ message: { type: "user" } }] })
    createRoot(() =>
      createController({
        data: { detail: () => ({ state: "ready", data: {} }), inbox, transcript },
        prompt: createPromptState(),
        composer: { submit: vi.fn(), compact: vi.fn(), cancel: vi.fn() },
        commands: {
          register: vi.fn((_key, value) => (options = value)),
          slash: { search: () => undefined, select: () => false },
        },
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )
    const compact = () => options().find((option) => option.id === "session.compact")

    expect(compact()?.disabled).toBe(false)
    setInbox({ state: "ready", data: [{ type: "compaction" }] })
    expect(compact()?.disabled).toBe(true)
    setInbox({ state: "ready", data: [] })
    setTranscript({
      state: "ready",
      data: [{ message: { type: "user" } }, { message: { type: "compaction", status: "completed" } }],
    })
    expect(compact()?.disabled).toBe(true)
    setTranscript({
      state: "ready",
      data: [
        { message: { type: "user" } },
        { message: { type: "compaction", status: "completed" } },
        { message: { type: "user" } },
      ],
    })
    expect(compact()?.disabled).toBe(false)
  })

  it("registers Ctrl+B only for top-level blocking subagent work", async () => {
    let options!: () => ReadonlyArray<{
      readonly id: string
      readonly title: string
      readonly description?: string
      readonly category?: string
      readonly keybind?: string
      readonly onSelect?: () => void
    }>
    const [eligible, setEligible] = createSignal(true)
    const [blocking, setBlocking] = createSignal(true)
    const background = vi.fn().mockResolvedValue(undefined)

    createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "" }),
        composer: { submit: vi.fn(), compact: vi.fn(), background, cancel: vi.fn() },
        commands: {
          register: vi.fn((_key, value) => (options = value)),
          slash: { search: () => undefined, select: () => false },
        },
        subagents: {
          eligible,
          blocking,
          command: "Continuar en segundo plano",
          description: "Dejar que los agentes continúen",
          error: "No se pudo continuar.",
          category: "Sesión",
        },
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    const command = () => options().find((option) => option.id === "session.background")
    expect(command()).toMatchObject({
      title: "Continuar en segundo plano",
      description: "Dejar que los agentes continúen",
      category: "Sesión",
      keybind: "ctrl+b",
    })
    command()?.onSelect?.()
    await vi.waitFor(() => expect(background).toHaveBeenCalledOnce())

    setBlocking(false)
    expect(command()).toBeUndefined()
    setBlocking(true)
    setEligible(false)
    expect(command()).toBeUndefined()
  })

  it("surfaces background request failures through the composer error owner", async () => {
    let options!: () => ReadonlyArray<{ readonly id: string; readonly onSelect?: () => void }>
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({ state: "ready", data: [] }),
        },
        prompt: createPromptState({ text: "" }),
        composer: {
          submit: vi.fn(),
          compact: vi.fn(),
          background: vi.fn().mockRejectedValue(new Error("offline")),
          cancel: vi.fn(),
        },
        commands: {
          register: vi.fn((_key, value) => (options = value)),
          slash: { search: () => undefined, select: () => false },
        },
        subagents: {
          eligible: () => true,
          blocking: () => true,
          command: "Continuar en segundo plano",
          description: "Dejar que los agentes continúen",
          error: "No se pudo continuar.",
          category: "Sesión",
        },
        projectDirectory: { search: vi.fn().mockResolvedValue([]) },
      } as never),
    )

    options()
      .find((option) => option.id === "session.background")
      ?.onSelect?.()
    await vi.waitFor(() => expect(controller.error()).toBe("offline"))
  })
})
