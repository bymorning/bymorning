/** Shared Project File scenarios: SDK seeding and a model script that writes through the real `write` Tool. */
export * as ProjectFile from "./project-file.js"

import { Effect } from "effect"
import assert from "node:assert/strict"
import type { TestApp } from "../application.js"
import type { TestLLM } from "../llm.js"
import type { Chat } from "./chat.js"

/** One Project File the scripted model writes, in order. */
export interface Write {
  readonly path: string
  readonly content: string
}

/**
 * Upload each file through the real generated SDK as the logged-in owner, in order. Every upload
 * publishes its own project.file.changed Event, so subscribe afterwards when counting later Events.
 */
export const seed = Effect.fn("ProjectFile.seed")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  files: readonly [Write, ...Write[]],
) {
  for (const file of files)
    yield* Effect.tryPromise(() =>
      app.client.project.directory.write({
        workspace: data.owner.properties.workspaceID,
        projectID: data.project.id,
        path: file.path,
        contentType: "text/plain",
        payload: new TextEncoder().encode(file.content),
      }),
    )
})

export interface Script {
  readonly prompt: string
  readonly answer: string
  readonly gate: string
}

/**
 * Register title/assistant responses for one conversation in which the model writes each file in
 * turn. Every write's actual Tool result is asserted in the next model request, and the final answer
 * waits at the returned gate. The caller owns prompt submission and lifecycle waits.
 */
export const script = Effect.fn("ProjectFile.script")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  writes: readonly [Write, ...Write[]],
) {
  const paths = writes.map((write) => write.path).join(" and ")
  const prompt = `Write ${paths}`
  const answer = `I wrote ${paths}.`
  const gate = `${data.session.id}:written`
  const id = (index: number) => `write-${index + 1}`
  const expectResult = (index: number) => (request: TestLLM.Request) => {
    const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === id(index))
    assert.ok(result, `The actual ${id(index)} result must reach the next model request`)
    assert.ok(
      JSON.stringify(result.content).includes(`Wrote Project File: @${writes[index]!.path}`),
      JSON.stringify(result),
    )
  }
  const expectPrompt = (request: TestLLM.Request) => {
    assert.ok(
      request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt)),
    )
    assert.ok(
      request.tools?.some((tool) => tool.function.name === "write"),
      "The real write Tool must be offered",
    )
  }
  yield* app.llm.expect(data.session.id, "title", [
    {
      expect: (request) =>
        assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
      response: { type: "success", events: [{ text: "Write project files" }] },
    },
  ])
  const steps: TestLLM.Step[] = writes.map((write, index) => ({
    expect: index === 0 ? expectPrompt : expectResult(index - 1),
    response: {
      type: "success",
      events: [{ tool: { id: id(index), name: "write", input: { path: write.path, content: write.content } } }],
    },
  }))
  yield* app.llm.expect(data.session.id, "assistant", [
    ...steps,
    {
      expect: expectResult(writes.length - 1),
      response: { type: "success", events: [{ gate }, { text: answer }], usage: { input: 12, output: 6 } },
    },
  ])
  return { prompt, answer, gate } satisfies Script
})
