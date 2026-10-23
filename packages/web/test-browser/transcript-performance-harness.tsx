import { ByMorning, type MessageListResponse, type SessionEventPayload } from "@bymorning/client"
import { createConnection, createData } from "@bymorning/client/solid"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { ID as EventID } from "@bymorning/schema/session-event"
import { Workspace } from "@bymorning/schema/workspace"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"

import "../src/main.css"
import "../src/session/screen.css"
import { createSessionProjection, type SessionReadiness } from "../src/context/session-state"
import { createController } from "../src/features/session/timeline-controller"
import { createTimelineInteraction } from "../src/features/session/timeline/interaction"
import { SessionTimeline } from "../src/features/session/ui/session-timeline"

document.documentElement.dataset.theme = "ink"
document.documentElement.dataset.colorScheme = "light"

const parameters = {
  entries: 5_000,
  pairs: 2_500,
  historyBytes: 256,
  pacedDeltas: 500,
  burstDeltas: 1_000,
  delta: "abcdefgh",
  paceMilliseconds: 20,
} as const

type RunMode = "paced" | "burst"
type RunResult = {
  readonly mode: RunMode
  readonly eventCount: number
  readonly wallTime: number
  readonly applyLatency: ReadonlyArray<number>
  readonly longTaskCount: number
  readonly longTaskDuration: number
  readonly checksum: string
  readonly mountedRowCount: number
  readonly rowIdentityPreserved: boolean
  readonly markdownIdentityPreserved: boolean
}
type HarnessApi = {
  readonly parameters: typeof parameters
  readonly ready: boolean
  readonly result: RunResult | undefined
  readonly error: string | undefined
  readonly start: (mode: RunMode) => void
  readonly run: (mode: RunMode) => Promise<RunResult>
}

declare global {
  interface Window {
    transcriptPerformance: HarnessApi
  }
}

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const provider = Provider.Name.make("benchmark")
const model = { provider, id: "fixture-model" }
const usage = {
  cost: 0,
  costComplete: true,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const targetID = MessageID.make("00000000-0000-4000-8000-000000005000")
const targetPartID = "target-text"
const initialTargetText = "Benchmark response: "
const historicalText = "Representative historical assistant transcript content. "
  .repeat(6)
  .slice(0, parameters.historyBytes)
type AssistantContent = Extract<MessageListResponse["data"][number], { readonly type: "assistant" }>["content"]

const id = (sequence: number) => MessageID.make(`00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`)
const messages = Array.from({ length: parameters.pairs }, (_, index) => {
  const userSequence = index * 2 + 1
  const assistantSequence = userSequence + 1
  const final = index === parameters.pairs - 1
  const assistantContent: AssistantContent = final
    ? [{ type: "text" as const, id: targetPartID, text: initialTargetText }]
    : [
        { type: "text" as const, id: `text-${assistantSequence}`, text: historicalText },
        ...(index % 10 === 0
          ? [
              {
                type: "tool" as const,
                id: `tool-${assistantSequence}`,
                name: "lookup",
                state: {
                  status: "completed" as const,
                  input: { query: "benchmark" },
                  content: [{ type: "text" as const, text: "settled" }],
                  result: "settled",
                },
                time: { created: new Date(assistantSequence), completed: new Date(assistantSequence + 1) },
              },
            ]
          : []),
      ]
  return [
    {
      id: id(userSequence),
      sessionID,
      sequence: userSequence,
      admittedSequence: userSequence,
      createdAt: new Date(userSequence),
      type: "user" as const,
      text: `Deterministic benchmark prompt ${index + 1}`,
    },
    {
      id: final ? targetID : id(assistantSequence),
      sessionID,
      sequence: assistantSequence,
      createdAt: new Date(assistantSequence),
      type: "assistant" as const,
      agent: Agent.DefaultID,
      model,
      content: assistantContent,
      ...(final ? {} : { finish: "stop" as const }),
      time: final
        ? { created: new Date(assistantSequence) }
        : { created: new Date(assistantSequence), completed: new Date(assistantSequence + 1) },
      usage,
    },
  ]
}).flat() satisfies MessageListResponse["data"]

function event(sequence: number): SessionEventPayload {
  return {
    id: EventID.make(`00000000-0000-4000-8001-${sequence.toString().padStart(12, "0")}`),
    type: "session.text.delta",
    created: 10_000 + sequence,
    data: { sessionID, messageID: targetID, partID: targetPartID, text: parameters.delta },
  }
}

function Harness() {
  const typed = new URLSearchParams(window.location.search).get("transport") === "typed"
  const queue: SessionEventPayload[] = []
  let waiting: ((item: SessionEventPayload | undefined) => void) | undefined
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const encoder = new TextEncoder()
  const push = (item: SessionEventPayload) => {
    if (typed) {
      const reader = waiting
      waiting = undefined
      if (reader) reader(item)
      else queue.push(item)
      return
    }
    stream?.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`))
  }
  const api = ByMorning.make({
    baseUrl: "http://benchmark.test",
    fetch: async (input) => {
      const url = new URL(input.toString())
      if (url.pathname === "/api/event")
        return new Response(
          new ReadableStream({
            start: (controller) => {
              stream = controller
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"00000000-0000-4000-8001-000000000000","type":"server.connected","data":{}}\n\n',
                ),
              )
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (url.pathname.endsWith("/message")) return Response.json({ data: messages, cursor: {} })
      if (url.pathname.endsWith("/inbox")) return Response.json({ data: [] })
      throw new Error(`Unexpected benchmark request: ${url.pathname}`)
    },
  })
  const workspace = Workspace.ID.make("wrk_benchmark")
  // Benchmark-only typed transport matches Phase 1's enqueue boundary. It substitutes
  // only the upstream event iterator; real Connection batching and Data remain in use.
  const transport: Pick<typeof api, "event"> = typed
    ? {
        event: {
          subscribe: async function* (_input, options) {
            const abort = () => {
              waiting?.(undefined)
              waiting = undefined
            }
            options?.signal?.addEventListener("abort", abort, { once: true })
            try {
              yield { id: EventID.make("00000000-0000-4000-8001-000000000000"), type: "server.connected", data: {} }
              while (!options?.signal?.aborted) {
                const item =
                  queue.length > 0
                    ? queue.shift()
                    : await new Promise<SessionEventPayload | undefined>((resolve) => {
                        waiting = resolve
                      })
                if (item === undefined) return
                yield item
              }
            } finally {
              options?.signal?.removeEventListener("abort", abort)
              abort()
            }
          },
        },
      }
    : api
  const eventSource = createConnection({ api: transport, workspace })
  const shared = createData({ api: () => api, workspace, event: eventSource })
  const [presentation, setPresentation] = createStore<{ readiness: SessionReadiness }>({
    readiness: { state: "loading" },
  })
  const state = createSessionProjection(shared, sessionID, () => presentation.readiness)
  const connection = {
    data: {
      ...state,
      policyNotices: () => [],
      models: () => [
        {
          ...model,
          name: "Fixture Model",
          providerLabel: "Benchmark",
          variants: [],
          limit: { context: 200_000, output: 16_000 },
        },
      ],
    },
    history: state,
  }
  onMount(() => {
    void Promise.all([shared.session.message.sync(sessionID), shared.session.inbox.sync(sessionID)]).then(() =>
      setPresentation("readiness", { state: "ready" }),
    )
  })
  const controller = createController(connection)
  const interaction = createTimelineInteraction({ history: controller.history })
  const [ready, setReady] = createSignal(false)
  const appliedSequence = () => {
    const transcript = connection.data.transcript()
    if (transcript.state !== "ready") return 0
    const message = transcript.data.at(-1)?.message
    if (message?.type !== "assistant") return 0
    const part = message.content.find((candidate) => candidate.type === "text" && candidate.id === targetPartID)
    return part?.type === "text"
      ? Math.floor((part.text.length - initialTargetText.length) / parameters.delta.length)
      : 0
  }

  createEffect(() => {
    if (controller.model().state !== "ready") return
    requestAnimationFrame(() => {
      interaction.toBottom()
      requestAnimationFrame(() => setReady(true))
    })
  })

  onMount(() => {
    let result: RunResult | undefined
    let error: string | undefined
    window.transcriptPerformance = {
      parameters,
      get ready() {
        return ready()
      },
      get result() {
        return result
      },
      get error() {
        return error
      },
      start: (mode) => {
        result = undefined
        error = undefined
        setTimeout(() => {
          window.transcriptPerformance.run(mode).then(
            (completed) => (result = completed),
            (cause) => (error = String(cause)),
          )
        }, 0)
      },
      run: async (mode) => {
        const count = mode === "paced" ? parameters.pacedDeltas : parameters.burstDeltas
        const target = document.querySelector<HTMLElement>(`[data-timeline-part-id="${targetPartID}"]`)
        const probe = document.querySelector<HTMLElement>("[data-transcript-apply-probe]")
        const row = target?.closest<HTMLElement>("[data-timeline-key]")
        const markdown = target?.querySelector<HTMLElement>('[data-component="markdown"]')
        if (!target || !probe || !row || !markdown) throw new Error("Mounted benchmark target was not found")
        const latencies: number[] = []
        const enqueued: number[] = []
        let applied = 0
        let longTaskCount = 0
        let longTaskDuration = 0
        let rowIdentityPreserved = true
        let markdownIdentityPreserved = true
        const collectLongTasks = (entries: PerformanceEntryList) => {
          for (const entry of entries) {
            longTaskCount += 1
            longTaskDuration += entry.duration
          }
        }
        const observer = new PerformanceObserver((list) => {
          collectLongTasks(list.getEntries())
        })
        observer.observe({ type: "longtask", buffered: false })
        const mutation = new MutationObserver(() => {
          const visible = Math.min(count, Number(probe.dataset.appliedSequence))
          const now = performance.now()
          while (applied < visible) latencies.push(now - enqueued[applied++]!)
          rowIdentityPreserved &&= row === target.closest("[data-timeline-key]")
          markdownIdentityPreserved &&= markdown === target.querySelector('[data-component="markdown"]')
        })
        mutation.observe(probe, { attributes: true, attributeFilter: ["data-applied-sequence"] })
        const started = performance.now()
        for (let sequence = 1; sequence <= count; sequence++) {
          enqueued.push(performance.now())
          push(event(sequence))
          // Exercise the same 50 events/second paced workload as the production baseline.
          if (mode === "paced") await new Promise((resolve) => setTimeout(resolve, parameters.paceMilliseconds))
        }
        while (applied !== count) await new Promise((resolve) => requestAnimationFrame(resolve))
        const text = initialTargetText + parameters.delta.repeat(count)
        while (target.textContent !== text) await new Promise((resolve) => requestAnimationFrame(resolve))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const wallTime = performance.now() - started
        mutation.disconnect()
        collectLongTasks(observer.takeRecords())
        observer.disconnect()
        const transcript = connection.data.transcript()
        const message = transcript.state === "ready" ? transcript.data.at(-1)?.message : undefined
        const part =
          message?.type === "assistant" ? message.content.find((candidate) => candidate.id === targetPartID) : undefined
        const checksum = [
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(part?.type === "text" ? part.text : "")),
          ),
        ]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
        return {
          mode,
          eventCount: applied,
          wallTime,
          applyLatency: latencies,
          longTaskCount,
          longTaskDuration,
          checksum,
          mountedRowCount: document.querySelectorAll("[data-timeline-key]").length,
          rowIdentityPreserved,
          markdownIdentityPreserved,
        }
      },
    }
  })
  onCleanup(() => stream?.close())

  return (
    <div data-component="session-workspace">
      <section data-slot="session-workspace-page" style={{ "grid-template-rows": "minmax(0, 1fr)" }}>
        <output data-transcript-apply-probe data-applied-sequence={appliedSequence()} hidden />
        <Show when={controller.model().state === "ready"}>
          <SessionTimeline
            model={controller.model()}
            sessionKey="transcript-performance"
            interaction={interaction}
            projectFiles={[]}
            preferences={{ showAgent: true, showReasoning: true, showUsage: true }}
            onFileOpen={() => undefined}
          />
        </Show>
      </section>
    </div>
  )
}

render(() => <Harness />, document.getElementById("root")!)
