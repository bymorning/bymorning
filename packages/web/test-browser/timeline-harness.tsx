import { batch, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"

import "../src/main.css"
import "../src/session/screen.css"
import { createTimelineInteraction } from "../src/features/session/timeline/interaction"
import { timelineVirtualizerSeedLegacyCache } from "../src/features/session/timeline/virtualizer"
import { createSessionHashScroll } from "../src/features/session/use-session-hash-scroll"
import type { SessionUI } from "../src/features/session/ui/session-model"
import { SessionHeader } from "../src/features/session/ui/session-header"
import { BackgroundHint } from "../src/features/session/ui/subagent-background"
import { SessionTimeline } from "../src/features/session/ui/session-timeline"
import { projectTimeline } from "../src/features/session/timeline/projection"

document.documentElement.dataset.theme = "ink"
document.documentElement.dataset.colorScheme =
  new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"

type HarnessApi = {
  readonly growLatest: (blocks?: number) => void
  readonly streamLatest: (text: string) => void
  readonly completeLatest: () => void
  readonly replaceWindow: () => void
  readonly resolveOlder: () => void
  readonly failOlder: () => void
  readonly loadCalls: () => number
  readonly pendingOlder: () => boolean
  readonly more: () => boolean
  readonly regrouped: () => boolean
  readonly pinned: () => boolean
  readonly remount: () => Promise<void>
  readonly reconnect: () => Promise<void>
  readonly navigateMessage: (offset: number) => void
  readonly showJump: () => void
  readonly setReasoning: (visible: boolean) => void
  readonly completeFooter: () => void
  readonly completeSkills: () => void
  readonly completeSubagents: () => void
  readonly resizeComposer: (height: number) => void
}

declare global {
  interface Window {
    timelineHarness: HarnessApi
  }
}

const parameters = new URLSearchParams(location.search)
const scenario = parameters.get("scenario") ?? "large"
const initialCount =
  scenario === "underfill" || scenario === "tools" || scenario === "footer" || scenario.startsWith("visual-")
    ? 1
    : scenario === "prepend" || scenario === "retry" || scenario === "hash"
      ? 90
      : 360
const pageSize = scenario === "underfill" ? 1 : 35
const firstIndex = scenario === "large" ? 0 : 300

if (scenario === "stale-cache") {
  const keys = [
    "user-message:user-1",
    "assistant-part:part:assistant-1:text-1",
    "turn-gap:user-stale",
    "user-message:user-stale",
    "assistant-part:part:assistant-stale:reasoning-stale",
    "assistant-part:part:assistant-stale:text-stale",
  ]
  timelineVirtualizerSeedLegacyCache(
    "timeline-browser-stale-cache",
    keys.map((key, index) => ({ index, key, start: index * 60, size: 60, end: (index + 1) * 60, lane: 0 })),
  )
}
const finalOlderIndex =
  scenario === "underfill"
    ? firstIndex - 8
    : scenario === "prepend" || scenario === "retry"
      ? firstIndex - pageSize
      : scenario === "hash"
        ? firstIndex - pageSize * 2
        : firstIndex

function turn(index: number, latest = false, tool = false): SessionUI.Turn {
  const id = `user-${index}`
  const parts: SessionUI.MessagePart[] = [
    {
      type: "text",
      id: `text-${index}`,
      text: latest
        ? "## Latest response\n\nNewest semantic row."
        : `History ${index}. ${"Representative timeline content. ".repeat(5)}`,
    },
  ]
  if (tool)
    parts.unshift({
      type: "tool",
      id: "tool-latest",
      name: "lookup",
      summary: "timeline fixture",
      input: { query: "geometry" },
      metadata: {},
      state: { type: "succeeded", output: Array.from({ length: 24 }, (_, line) => `result ${line + 1}`).join("\n") },
    })
  return {
    type: "turn",
    id,
    user: {
      id: `user-${index}`,
      text:
        latest && scenario === "long-user"
          ? Array.from(
              { length: 18 },
              (_, line) => `Detailed attachment instruction ${line + 1}: preserve this requested behavior and ordering.`,
            ).join("\n")
          : `Prompt ${index}`,
    },
    assistant: [
      {
        id: `assistant-${index}`,
        parts,
        streaming: false,
        details: { agent: "build", model: "Fixture Model", durationMs: 1_200 },
      },
    ],
    state: { type: "complete" },
  }
}

function boundaryFragment(index: number): SessionUI.Turn {
  const item = turn(index)
  return {
    ...item,
    assistant: item.assistant.map((message) => ({
      ...message,
      parts: [
        ...message.parts,
        {
          type: "tool" as const,
          id: `fragment-tool-${index}`,
          name: "lookup",
          summary: "Regrouped history boundary",
          input: {},
          metadata: {},
          state: { type: "succeeded" as const, output: "boundary" },
        },
      ],
    })),
  }
}

function toolTurn(): SessionUI.Turn {
  return {
    type: "turn",
    id: "turn-tools",
    user: { id: "user-tools", text: "Inspect and update the session timeline tools." },
    assistant: [
      {
        id: "assistant-tools",
        streaming: false,
        details: { agent: "build", model: "Fixture Model", durationMs: 2_400 },
        parts: [
          {
            type: "tool",
            id: "read-tools",
            name: "read",
            input: { path: "src/features/session/timeline.ts", offset: 20, limit: 80 },
            metadata: {},
            state: { type: "succeeded", output: "export function timeline() {}" },
          },
          {
            type: "tool",
            id: "grep-tools",
            name: "grep",
            input: { path: "src/features/session", pattern: "ToolDisplay", include: "*.tsx" },
            metadata: { matches: 4 },
            state: { type: "succeeded", output: "tools/tool-display.tsx:10" },
          },
          {
            type: "tool",
            id: "patch-tools",
            name: "patch",
            input: {},
            metadata: {
              files: [
                {
                  file: "src/features/session/tool.tsx",
                  patch: "@@ -1 +1 @@\n-old tool\n+new tool",
                  additions: 1,
                  deletions: 1,
                  status: "modified",
                },
                {
                  file: "src/features/session/tool.css",
                  patch: "+[data-component=tool] { display: flex; }",
                  additions: 1,
                  deletions: 0,
                  status: "added",
                },
              ],
            },
            state: { type: "succeeded" },
          },
          {
            type: "tool",
            id: "write-tools",
            name: "write",
            input: { path: "src/features/session/status.ts", content: "export const status = 'ready'" },
            metadata: {},
            state: { type: "succeeded" },
          },
          {
            type: "tool",
            id: "running-tools",
            name: "shell",
            summary: "bun typecheck",
            input: { command: "bun typecheck" },
            metadata: {},
            state: { type: "running" },
          },
          {
            type: "tool",
            id: "generic-success-tools",
            name: "lookup",
            summary: "fixture result",
            input: { query: "timeline parity" },
            metadata: {},
            state: { type: "succeeded", output: "A deterministic generic tool result." },
          },
          {
            type: "tool",
            id: "generic-failed-tools",
            name: "deploy",
            summary: "preview environment",
            input: { target: "preview" },
            metadata: {},
            state: { type: "failed", message: "Preview environment is unavailable" },
          },
          {
            type: "tool",
            id: "failed-tools",
            name: "edit",
            input: { path: "src/features/session/missing.ts" },
            metadata: {},
            state: { type: "failed", message: "No matching text found in file" },
          },
        ],
      },
    ],
    state: { type: "complete" },
  }
}

function visualContent(): ReadonlyArray<SessionUI.Item> {
  return [
    { type: "notice", id: "notice-system", kind: "system", text: "Connected to the ByMorning workspace" },
    {
      type: "turn",
      id: "visual-content",
      user: {
        id: "user-content",
        text: "Explain the timeline design and reference @src/features/session/timeline/projection.ts please.",
      },
      assistant: [
        {
          id: "assistant-content",
          streaming: false,
          details: { agent: "build", model: "Claude Sonnet 4", durationMs: 3_420 },
          parts: [
            {
              type: "reasoning",
              id: "reasoning-content",
              text: "We need inspect the projection boundary, preserve stable row keys, and keep the virtualizer in control.",
            },
            {
              type: "text",
              id: "text-content",
              text: "## Timeline design\n\nThe session timeline keeps **protocol data** separate from presentation.\n\n- Stable user-message anchors\n- Grouped tool activity\n- Virtualized markdown rendering\n\n```ts\nconst rows = projectTimeline(items, preferences)\n```",
            },
          ],
        },
      ],
      state: { type: "complete" },
    },
    { type: "notice", id: "notice-selection", kind: "selection", text: "Model switched to Claude Sonnet 4" },
    {
      type: "notice",
      id: "notice-compaction",
      kind: "compaction",
      text: "Session compacted",
      detail: "completed",
    },
  ]
}

function staleCacheContent(): ReadonlyArray<SessionUI.Item> {
  return [
    turn(1),
    {
      type: "turn",
      id: "user-stale",
      user: { id: "user-stale", text: "Verify restored timeline geometry." },
      assistant: [
        {
          id: "assistant-stale",
          streaming: false,
          details: { agent: "build", model: "Fixture Model", durationMs: 1_200 },
          parts: [
            {
              type: "reasoning",
              id: "reasoning-stale",
              text: Array.from({ length: 12 }, (_, index) => `Reasoning line ${index + 1}.`).join("\n\n"),
            },
            {
              type: "text",
              id: "text-stale",
              text: "## Corrected geometry\n\nAssistant actions must remain inside this measured row.",
            },
          ],
        },
      ],
      state: { type: "complete" },
    },
  ]
}

function visualStatus(): ReadonlyArray<SessionUI.Item> {
  return [
    {
      type: "turn",
      id: "visual-interrupted",
      user: { id: "user-interrupted", text: "Stop after checking the current implementation." },
      assistant: [
        {
          id: "assistant-interrupted",
          streaming: false,
          parts: [{ type: "text", id: "text-interrupted", text: "I inspected the current timeline implementation." }],
        },
      ],
      state: { type: "interrupted" },
    },
    {
      type: "turn",
      id: "visual-failed",
      user: { id: "user-failed", text: "Read the missing session fixture." },
      assistant: [],
      state: {
        type: "failed",
        failure: { type: "generic", message: "Unable to read src/features/session/missing-fixture.ts" },
      },
    },
    {
      type: "turn",
      id: "visual-thinking",
      user: { id: "user-thinking", text: "Continue with the visual comparison." },
      assistant: [],
      state: { type: "working" },
    },
  ]
}

function visualStreaming(): ReadonlyArray<SessionUI.Item> {
  return [
    {
      type: "turn",
      id: "visual-streaming",
      user: { id: "user-streaming", text: "Summarize the visual parity work completed so far." },
      assistant: [
        {
          id: "assistant-streaming",
          streaming: true,
          details: { agent: "build", model: "Claude Sonnet 4" },
          parts: [
            {
              type: "reasoning",
              id: "reasoning-streaming",
              text: "The geometry and token mapping are stable. I should summarize the remaining comparison evidence.",
            },
            {
              type: "text",
              id: "text-streaming",
              text: "The timeline now matches the reference row spacing, semantic notices, and responsive frame. I’m checking the final visual states…",
            },
          ],
        },
      ],
      state: { type: "working" },
    },
  ]
}

function visualShell(): ReadonlyArray<SessionUI.Item> {
  return [
    {
      type: "turn",
      id: "visual-shell",
      user: { id: "user-shell", text: "Run the final package checks." },
      assistant: [
        {
          id: "assistant-shell",
          streaming: false,
          parts: [
            {
              type: "tool",
              id: "shell-output",
              name: "shell",
              summary: "bun typecheck",
              input: { command: "bun typecheck" },
              metadata: {},
              state: { type: "succeeded", output: "Checked 214 files in 1.8s\nNo errors found." },
            },
          ],
        },
      ],
      state: { type: "complete" },
    },
  ]
}

function footerContent(): ReadonlyArray<SessionUI.Item> {
  return [
    ...Array.from({ length: 40 }, (_, index) => turn(600 + index)),
    {
      type: "turn",
      id: "footer-turn",
      user: { id: "footer-user", text: "Finish the response footer.", createdAt: 2_000 },
      assistant: [
        {
          id: "footer-assistant-first",
          streaming: false,
          details: { agent: "explore", model: "First Model", completedAt: 4_000 },
          parts: [
            { type: "text", id: "footer-first", text: "First response." },
            { type: "text", id: "footer-middle", text: "Middle response." },
          ],
        },
        {
          id: "footer-assistant-final",
          streaming: true,
          details: { agent: "build", model: "Final Model" },
          parts: [{ type: "text", id: "footer-final", text: "Final response only." }],
        },
      ],
      state: { type: "working" },
    },
  ]
}

function skillContent(): ReadonlyArray<SessionUI.Item> {
  return [
    {
      type: "turn",
      id: "skill-turn",
      user: { id: "skill-user", text: "Load the skills needed for this task." },
      assistant: [
        {
          id: "skill-assistant",
          streaming: false,
          parts: [
            {
              type: "tool",
              id: "skill-settled",
              name: "skill",
              input: { id: "ignored-input-id", name: "ignored-input-name" },
              metadata: { name: "source-conformant-skill-with-a-name-that-must-truncate-on-mobile" },
              state: { type: "succeeded", output: "Hidden skill instructions" },
            },
            {
              type: "tool",
              id: "skill-running",
              name: "skill",
              input: { id: "browser-control" },
              metadata: {},
              state: { type: "running" },
            },
            {
              type: "tool",
              id: "skill-fallback",
              name: "skill",
              input: {},
              metadata: {},
              state: { type: "running" },
            },
          ],
        },
      ],
      state: { type: "complete" },
    },
  ]
}

const subagentChild = "00000000-0000-4000-8000-000000000010"

function subagentContent(): ReadonlyArray<SessionUI.Item> {
  const part = (
    id: string,
    state: SessionUI.ToolState,
    metadata: SessionUI.JsonRecord = {},
    input: SessionUI.JsonRecord = { agent: "explore", description: `${id} task` },
  ): SessionUI.ToolPart => ({ type: "tool", id, name: "subagent", input, metadata, state })
  return [
    {
      type: "turn",
      id: "subagent-turn",
      user: { id: "subagent-user", text: "Delegate the independent checks." },
      assistant: [
        {
          id: "subagent-assistant",
          streaming: false,
          parts: [
            { ...part("streaming-subagent", { type: "running" }, {}, {}), inputStreaming: true },
            part("running-subagent", { type: "running" }),
            part("progress-subagent", { type: "running" }, { sessionID: subagentChild, status: "running" }),
            part("completed-subagent", { type: "succeeded" }, { sessionID: subagentChild, status: "completed" }),
            part("background-subagent", { type: "succeeded" }, { sessionID: subagentChild, status: "running" }),
            part(
              "failed-subagent",
              { type: "failed", message: "Provider quota exhausted" },
              {
                sessionID: subagentChild,
              },
            ),
            part("cancelled-subagent", { type: "interrupted" }, { sessionID: subagentChild }),
          ],
        },
      ],
      state: { type: "working" },
    },
  ]
}

function Harness() {
  let workspace!: HTMLDivElement
  let page!: HTMLElement
  const [mounted, setMounted] = createSignal(true)
  const [showReasoning, setShowReasoning] = createSignal(true)
  const [routeHash, setRouteHash] = createSignal(location.hash)
  const [subagentActivity, setSubagentActivity] = createSignal<"running" | "idle">("running")
  const [openedSession, setOpenedSession] = createSignal<string>()
  const [composerHeight, setComposerHeight] = createSignal(112)
  const [items, setItems] = createSignal<ReadonlyArray<SessionUI.Item>>(
    scenario === "visual-empty"
      ? []
      : scenario === "stale-cache"
        ? staleCacheContent()
        : scenario === "footer"
          ? footerContent()
          : scenario === "visual-skill"
            ? skillContent()
            : scenario === "visual-subagents"
              ? subagentContent()
              : scenario === "visual-content"
                ? visualContent()
                : scenario === "visual-status"
                  ? visualStatus()
                  : scenario === "visual-streaming"
                    ? visualStreaming()
                    : scenario === "visual-shell"
                      ? visualShell()
                      : scenario === "tools" || scenario === "visual-tools"
                        ? [toolTurn()]
                        : Array.from({ length: initialCount }, (_, offset) =>
                            scenario === "prepend" && offset === 0
                              ? boundaryFragment(firstIndex)
                              : turn(firstIndex + offset, offset === initialCount - 1, offset === initialCount - 2),
                          ),
  )
  const [more, setMore] = createSignal(
    scenario !== "large" && scenario !== "long-user" && scenario !== "tools" && !scenario.startsWith("visual-"),
  )
  const [loading, setLoading] = createSignal(false)
  const [olderError, setOlderError] = createSignal<string>()
  let calls = 0
  let nextOlderIndex = firstIndex
  let releaseOlder: ((success: boolean) => void) | undefined
  let regrouped = false
  const history = {
    ready: () => true,
    messages: items,
    more,
    loading,
    olderError,
    loadOlder: async () => {
      calls += 1
      setLoading(true)
      const success =
        scenario === "prepend" || scenario === "retry"
          ? await new Promise<boolean>((resolve) => (releaseOlder = resolve))
          : true
      if (!success) {
        batch(() => {
          setOlderError("History request failed")
          setLoading(false)
        })
        return false
      }
      const start = Math.max(finalOlderIndex, nextOlderIndex - pageSize)
      const older = Array.from({ length: nextOlderIndex - start }, (_, offset) => turn(start + offset))
      batch(() => {
        nextOlderIndex = start
        setItems((current) => {
          if (scenario !== "prepend" || older.length === 0) return [...older, ...current]
          regrouped = true
          return [
            ...older,
            {
              ...current[0]!,
              assistant:
                current[0]?.type === "turn"
                  ? current[0].assistant.map((message) => ({
                      ...message,
                      parts: message.parts.map((part) =>
                        part.id === `fragment-tool-${firstIndex}`
                          ? { ...part, id: `tool-boundary-${firstIndex}` }
                          : part,
                      ),
                    }))
                  : [],
            },
            ...current.slice(1),
          ]
        })
        setMore(start > finalOlderIndex)
        setOlderError(undefined)
        setLoading(false)
      })
      return true
    },
  }
  const interaction = createTimelineInteraction({ history })
  const navigation = createSessionHashScroll({
    sessionKey: () => `timeline-browser-${scenario}`,
    sessionID: () => `timeline-browser-${scenario}`,
    messagesReady: history.ready,
    visibleUserMessages: () => items().flatMap((item) => (item.type === "turn" && item.user ? [item.user] : [])),
    historyMore: history.more,
    historyLoading: history.loading,
    loadMore: history.loadOlder,
    interaction,
    route: {
      hash: routeHash,
      replace: (hash) => {
        window.history.replaceState(null, "", location.pathname + location.search + hash)
        setRouteHash(hash)
      },
    },
  })

  const growLatest = (blocks = 18) =>
    setItems((current) =>
      current.map((item, index) => {
        if (index !== current.length - 1 || item.type !== "turn") return item
        return {
          ...item,
          assistant: item.assistant.map((message) => ({
            ...message,
            parts: message.parts.map((part) =>
              part.type === "text"
                ? {
                    ...part,
                    text: `${part.text}\n\n${Array.from({ length: blocks }, (_, block) => `### Growth ${block + 1}\n\nAdditional markdown content.`).join("\n\n")}`,
                  }
                : part,
            ),
          })),
        }
      }),
    )

  onMount(() => {
    const updateHash = () => setRouteHash(location.hash)
    window.addEventListener("hashchange", updateHash)
    window.addEventListener("popstate", updateHash)
    onCleanup(() => {
      window.removeEventListener("hashchange", updateHash)
      window.removeEventListener("popstate", updateHash)
    })
    window.timelineHarness = {
      growLatest,
      streamLatest: (text) =>
        setItems((current) =>
          current.map((item, index) =>
            index !== current.length - 1 || item.type !== "turn"
              ? item
              : {
                  ...item,
                  state: { type: "working" },
                  assistant: item.assistant.map((message) => ({
                    ...message,
                    streaming: true,
                    parts: message.parts.map((part) =>
                      part.type === "text" ? { ...part, text: `${part.text}${text}` } : part,
                    ),
                  })),
                },
          ),
        ),
      completeLatest: () =>
        setItems((current) =>
          current.map((item, index) =>
            index !== current.length - 1 || item.type !== "turn"
              ? item
              : {
                  ...item,
                  state: { type: "complete" },
                  assistant: item.assistant.map((message) => ({ ...message, streaming: false })),
                },
          ),
        ),
      replaceWindow: () => {
        setItems(Array.from({ length: 6 }, (_, index) => turn(900 + index, index === 5)))
        queueMicrotask(interaction.toBottom)
      },
      resolveOlder: () => {
        releaseOlder?.(true)
        releaseOlder = undefined
      },
      failOlder: () => {
        releaseOlder?.(false)
        releaseOlder = undefined
      },
      loadCalls: () => calls,
      pendingOlder: () => releaseOlder !== undefined,
      more,
      regrouped: () => regrouped,
      pinned: interaction.pinned,
      remount: () =>
        new Promise((resolve) => {
          setMounted(false)
          requestAnimationFrame(() => {
            setMounted(true)
            requestAnimationFrame(() => resolve())
          })
        }),
      reconnect: () =>
        new Promise((resolve) => {
          page.remove()
          requestAnimationFrame(() => {
            workspace.append(page)
            requestAnimationFrame(() => resolve())
          })
        }),
      navigateMessage: navigation.navigateMessage,
      showJump: () => {
        interaction.unpinExplicit()
        const viewport = document.querySelector<HTMLDivElement>('[data-slot="scroll-view-viewport"]')
        if (!viewport) return
        viewport.scrollTop = 0
        viewport.dispatchEvent(new Event("scroll"))
      },
      setReasoning: setShowReasoning,
      completeFooter: () =>
        setItems((current) =>
          current.map((item) =>
            item.type !== "turn" || item.id !== "footer-turn"
              ? item
              : {
                  ...item,
                  assistant: item.assistant.map((message) => ({
                    ...message,
                    streaming: false,
                    ...(message.id === "footer-assistant-final"
                      ? { details: { agent: "build", model: "Final Model", completedAt: 8_400 } }
                      : {}),
                  })),
                  state: { type: "complete" },
                },
          ),
        ),
      completeSkills: () =>
        setItems((current) =>
          current.map((item) =>
            item.type !== "turn" || item.id !== "skill-turn"
              ? item
              : {
                  ...item,
                  assistant: item.assistant.map((message) => ({
                    ...message,
                    parts: message.parts.map((part) =>
                      part.type === "tool" && part.name === "skill" ? { ...part, state: { type: "succeeded" } } : part,
                    ),
                  })),
                },
          ),
        ),
      completeSubagents: () => setSubagentActivity("idle"),
      resizeComposer: setComposerHeight,
    }
  })

  return (
    <div ref={(element) => (workspace = element)} data-component="session-workspace">
      <section
        ref={(element) => (page = element)}
        data-slot="session-workspace-page"
        style={{ "grid-template-rows": "minmax(0, 1fr) auto" }}
      >
        <Show when={mounted()}>
          <SessionTimeline
            model={{
              state: "ready",
              items: items(),
              ...projectTimeline(items(), { showAgent: true, showReasoning: showReasoning(), showUsage: true }),
            }}
            sessionKey={`timeline-browser-${scenario}`}
            interaction={interaction}
            footer={scenario === "visual-subagents" ? <BackgroundHint /> : undefined}
            projectFiles={scenario === "visual-content" ? ["src/features/session/timeline/projection.ts"] : []}
            preferences={{ showAgent: true, showReasoning: showReasoning(), showUsage: true }}
            onFileOpen={() => undefined}
            agents={[{ id: "explore", name: "Explorer", color: "var(--color-agent-explore)" }]}
            actions={{
              sessionHref: (sessionID) => `#session-${sessionID}`,
              openSession: setOpenedSession,
              sessionStatus: (sessionID) => (sessionID === subagentChild ? subagentActivity() : "idle"),
            }}
            header={
              <SessionHeader
                title={
                  scenario === "tools" || scenario === "visual-tools"
                    ? "Tool rendering session"
                    : scenario === "visual-shell"
                      ? "Shell output session"
                      : scenario.startsWith("visual-")
                        ? "Visual verification session"
                        : "Timeline geometry session"
                }
                workspace="Browser workspace"
                project={{ name: "Timeline project" }}
                usage={{ tokens: 12_345, cost: 0.42, costComplete: true, percentage: 6 }}
                status={scenario === "tools" || scenario === "visual-tools" ? "running" : "idle"}
                {...(scenario === "visual-subagents"
                  ? {
                      backgroundTasks: [
                        {
                          id: `subagent:${subagentChild}:1`,
                          kind: "subagent",
                          title: "Explorer",
                          color: "var(--color-agent-explore)",
                          description: "background-subagent task",
                          sessionID: subagentChild,
                        },
                        {
                          id: "shell:shell-1:1",
                          kind: "shell",
                          title: "Shell",
                          description: "bun test",
                        },
                      ],
                      sessionHref: (sessionID: string) => `#session-${sessionID}`,
                      openSession: setOpenedSession,
                    }
                  : {})}
                rename={async () => true}
                sidebarOpen={false}
                sidebarRef={() => {}}
                toggleSidebar={() => undefined}
              />
            }
          />
        </Show>
        <output data-opened-session hidden={!openedSession()}>
          {openedSession()}
        </output>
        <div ref={(element) => interaction.setComposerRef(element)} data-slot="session-workspace-composer">
          <div
            data-motion-probe
            style={{
              position: "absolute",
              animation: "motion-probe 10s linear infinite",
              transition: "transform 10s linear",
            }}
          />
          <div
            data-slot="session-workspace-composer-content"
            style={{
              height: `${composerHeight()}px`,
              border: "1px solid var(--color-border-base)",
              "border-radius": "12px",
              background: "var(--color-bg-base)",
            }}
          >
            <textarea aria-label="Composer fixture" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </section>
    </div>
  )
}

render(() => <Harness />, document.getElementById("root")!)
