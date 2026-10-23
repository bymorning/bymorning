/** Shared Share/unshare model scripts for backend, SDK, and browser tests. */
export * as ShareScenario from "./share.js"

import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import assert from "node:assert/strict"
import type { TestApp } from "../application.js"
import type { Chat } from "./chat.js"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Parsed public Share grant from the real share Tool result. */
export interface Grant {
  url: string
  token: string
}

/** Deterministic Share or unshare conversation registered against a real Session. */
export interface Script {
  readonly prompt: string
  readonly title: string
  readonly gate: string
  readonly grant: Grant
  readonly answer: string
}

/** Read the UUID token and `/s/{workspaceID}/{token}` URL from a share Tool result. */
export const parseGrant = (content: unknown, workspaceID: string): Grant => {
  const text = typeof content === "string" ? content : JSON.stringify(content)
  const token = text.match(UUID)?.[0]
  assert.ok(token, `share-1 result must include a UUID token: ${text}`)
  const url = `/s/${workspaceID}/${token}`
  assert.ok(text.includes(url), `share-1 result must include ${url}: ${text}`)
  return { url, token }
}

/** Register title/assistant responses; the caller owns prompt submission and lifecycle waits. */
export const script = Effect.fn("ShareScenario.script")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  kind: "share" | "unshare",
) {
  const prompt = kind === "share" ? "Share this conversation" : "Unshare this conversation"
  const title = "Shared conversation"
  const gate = `${data.session.id}:${kind}`
  const grant: Grant = { url: "", token: "" }
  const events: Array<{ gate: string } | { text: string }> = [{ gate }]
  const workspaceID = data.owner.properties.workspaceID
  const expectPrompt = (request: import("../llm.js").Request) => {
    assert.ok(
      request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt)),
    )
  }
  if (kind === "share") {
    yield* app.llm.expect(data.session.id, "title", [
      {
        expect: (request) =>
          assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
        response: { type: "success", events: [{ text: title }] },
      },
    ])
  }
  yield* app.llm.expect(data.session.id, "assistant", [
    {
      expect: (request) => {
        expectPrompt(request)
        assert.ok(
          request.tools?.some((tool) => tool.function.name === kind),
          `The real ${kind} Tool must be offered`,
        )
      },
      response: {
        type: "success",
        events: [{ tool: { id: `${kind}-1`, name: kind, input: {} } }],
      },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === `${kind}-1`)
        assert.ok(result, `The next model request must include the real ${kind}-1 result`)
        if (kind === "share") {
          const parsed = parseGrant(result.content, workspaceID)
          grant.url = parsed.url
          grant.token = parsed.token
          events.push({ text: `Share it at ${parsed.url}` })
          return
        }
        assert.ok(JSON.stringify(result.content).includes("unshared"), JSON.stringify(result))
        events.push({ text: "The conversation is no longer shared." })
      },
      response: { type: "success", events, usage: { input: 12, output: 6 } },
    },
  ])
  return {
    prompt,
    title,
    gate,
    grant,
    get answer() {
      const event = events.find((item) => "text" in item)
      return event && "text" in event ? event.text : ""
    },
  } satisfies Script
})

/** Submit the scripted prompt and wait until the Session is idle. */
export const complete = Effect.fn("ShareScenario.complete")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  script: Script,
) {
  yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: script.prompt })),
  )
  yield* app.llm.waitGate(script.gate)
  yield* app.llm.release(script.gate)
  yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
  )
})
