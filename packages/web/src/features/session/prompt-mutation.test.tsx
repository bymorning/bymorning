import { createData, type Data } from "@bymorning/client/solid"
import type { WorkspaceEventItem } from "@bymorning/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Gate, TestEvents, TestTransport, ids, admission, json } from "../../../../client/test/solid/fixture"
import { createPromptState } from "../../context/prompt-state"
import { createPromptSubmissionState } from "./prompt-submission-state"
import { createPromptMutation } from "./prompt-mutation"

function mount() {
  const transport = new TestTransport()
  const events = new TestEvents()
  const sdkPrompt = vi.spyOn(transport.api.session, "prompt")
  let data!: Data
  let mutation!: ReturnType<typeof createPromptMutation>
  let draft!: ReturnType<typeof createPromptState>
  const complete = vi.fn()
  function Harness() {
    data = createData({ api: () => transport.api, workspace: ids.workspace, event: events, report: () => {} })
    draft = createPromptState({ text: "Review" })
    mutation = createPromptMutation(data, ["http://solid.test", "test", ids.workspace, "session", "prompt"])
    return null
  }
  const query = new QueryClient()
  const view = render(() => (
    <QueryClientProvider client={query}>
      <Harness />
    </QueryClientProvider>
  ))
  return {
    transport,
    sdkPrompt,
    events,
    data,
    mutation,
    draft,
    complete,
    dispose: () => {
      view.unmount()
      query.clear()
    },
    submit: () =>
      mutation.mutateAsync({
        sessionID: ids.session,
        text: draft.current(),
        submission: createPromptSubmissionState({ target: draft, complete }),
      }),
  }
}

afterEach(cleanup)

describe("native prompt mutation with shared Data and generated SDK", () => {
  it("retains a known failed submission until explicit dismissal", async () => {
    const mounted = mount()
    mounted.transport.when(
      (request) => request.url.pathname.endsWith("/prompt"),
      (request) => {
        const body = JSON.parse(String(request.init.body))
        return json(
          { _tag: "Session.PromptConflictError", sessionID: ids.session, messageID: body.id, message: "conflict" },
          409,
        )
      },
    )
    try {
      const error = await mounted.submit().catch((cause) => cause)
      expect(error).toMatchObject({ _tag: "Session.PromptConflictError" })
      expect(mounted.mutation.error).toBe(error)
      await expect(mounted.sdkPrompt.mock.results[0]!.value).rejects.toBe(error)
      const row = mounted.data.session.submission.list(ids.session)[0]!
      expect(row.state.state).toBe("failed")
      expect(mounted.draft.current()).toBe("Review")
      mounted.data.session.submission.dismiss(ids.session, row.id)
      expect(mounted.data.session.submission.list(ids.session)).toEqual([])
    } finally {
      mounted.dispose()
    }
  })

  it("does not roll back authoritative running status after a failed admission", async () => {
    const mounted = mount()
    const response = new Gate<Response>()
    mounted.transport.when((request) => request.url.pathname.endsWith("/prompt"), response.promise)
    try {
      const pending = mounted.submit().catch((cause) => cause)
      await mounted.transport.receipt(`/api/session/${ids.session}/prompt`)
      mounted.events.emit({
        id: "run-started" as WorkspaceEventItem["id"],
        created: 1,
        type: "session.run.started",
        data: { sessionID: ids.session },
      })
      response.reject(new Error("offline"))
      await pending
      expect(mounted.data.session.active.get(ids.session)).toBe("running")
      expect(mounted.data.session.submission.list(ids.session)).toHaveLength(1)
    } finally {
      mounted.dispose()
    }
  })

  it("owns pending, sends steer, and completes only after admission", async () => {
    const mounted = mount()
    const response = new Gate<Response>()
    mounted.transport.when((request) => request.url.pathname.endsWith("/prompt"), response.promise)
    try {
      const pending = mounted.submit()
      expect(mounted.mutation.isPending).toBe(true)
      const request = await mounted.transport.receipt(`/api/session/${ids.session}/prompt`)
      const body = JSON.parse(String(request.init.body))
      expect(body).toMatchObject({ text: "Review", delivery: "steer", agents: [] })
      expect(mounted.draft.current()).toBe("")
      expect(mounted.complete).not.toHaveBeenCalled()
      response.resolve(json(admission(body.id), 202))
      await pending
      expect(mounted.mutation.isPending).toBe(false)
      expect(mounted.complete).toHaveBeenCalledOnce()
      expect(mounted.data.session.submission.list(ids.session)).toEqual([])
    } finally {
      mounted.dispose()
    }
  })

  it("retains uncertainty, preserves error identity, and reuses the ID on explicit retry", async () => {
    const mounted = mount()
    const failure = new Error("connection lost")
    mounted.transport.when(
      (request) => request.url.pathname.endsWith("/prompt"),
      () => Promise.reject(failure),
    )
    try {
      const error = await mounted.submit().catch((cause) => cause)
      expect(error).toMatchObject({ reason: "Transport" })
      expect(mounted.mutation.error).toBe(error)
      await expect(mounted.sdkPrompt.mock.results[0]!.value).rejects.toBe(error)
      expect(mounted.draft.current()).toBe("Review")
      const row = mounted.data.session.submission.list(ids.session)[0]!
      expect(row.state.state).toBe("uncertain")
      mounted.transport.when((request) => request.url.pathname.endsWith("/prompt"), json(admission(row.id), 202))
      await mounted.submit()
      const bodies = mounted.transport.requests.map((request) => JSON.parse(String(request.init.body)))
      expect(bodies.map((body) => body.id)).toEqual([row.id, row.id])
      expect(mounted.complete).toHaveBeenCalledOnce()
    } finally {
      mounted.dispose()
    }
  })

  it.each(["before execution", "after request"] as const)(
    "does not overwrite new edits %s on failure",
    async (timing) => {
      const mounted = mount()
      const response = new Gate<Response>()
      mounted.transport.when((request) => request.url.pathname.endsWith("/prompt"), response.promise)
      try {
        const pending = mounted.submit()
        const rejected = expect(pending).rejects.toMatchObject({ reason: "Transport" })
        if (timing === "before execution") mounted.draft.set("New work", 3)
        await mounted.transport.receipt(`/api/session/${ids.session}/prompt`)
        if (timing === "after request") mounted.draft.set("New work", 3)
        response.reject(new Error("offline"))
        await rejected
        expect(mounted.draft.current()).toBe("New work")
        expect(mounted.draft.cursor()).toBe(3)
        expect(mounted.complete).not.toHaveBeenCalled()
        expect(mounted.data.session.submission.list(ids.session)).toHaveLength(1)
      } finally {
        mounted.dispose()
      }
    },
  )

  it("does not restore a duplicate when admission precedes an HTTP rejection", async () => {
    const mounted = mount()
    const response = new Gate<Response>()
    mounted.transport.when((request) => request.url.pathname.endsWith("/prompt"), response.promise)
    try {
      const pending = mounted.submit()
      const failure = new Error("late HTTP failure")
      const rejected = pending.catch((cause) => cause)
      await mounted.transport.receipt(`/api/session/${ids.session}/prompt`)
      const row = mounted.data.session.submission.list(ids.session)[0]!
      mounted.events.emit({
        id: "event-admission" as WorkspaceEventItem["id"],
        created: 1,
        type: "session.input.admitted",
        data: {
          sessionID: ids.session,
          item: {
            id: row.id,
            sessionID: ids.session,
            admittedSequence: 1,
            createdAt: new Date(),
            type: "user",
            payload: { text: "Review" },
            delivery: "steer",
          },
        },
      })
      response.reject(failure)
      const error = await rejected
      expect(mounted.draft.current()).toBe("")
      expect(mounted.complete).toHaveBeenCalledOnce()
      expect(mounted.data.session.submission.list(ids.session)).toEqual([])
      expect(mounted.mutation.error).toBe(error)
      await expect(mounted.sdkPrompt.mock.results[0]!.value).rejects.toBe(error)
    } finally {
      mounted.dispose()
    }
  })
})
