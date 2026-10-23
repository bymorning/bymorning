import { Session } from "@bymorning/core/session"
import { Job } from "@bymorning/core/job"
import { Bus } from "@bymorning/core/bus"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Storage } from "@bymorning/core/storage"
import { ID as OutputID } from "@bymorning/schema/tool-output"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Effect, Option, Stream } from "effect"
import { execFile, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { ExecutionScenario } from "../src/scenario/execution.js"

const docker = (...args: string[]) => Effect.tryPromise((signal) => promisify(execFile)("docker", args, { signal }))
const containers = (sessionID: string) => docker("ps", "--all", "--quiet", "--filter", `label=bymorning.session=${sessionID}`)

// Replaying events prevents an attachment race without polling or readiness sleeps.
const starts = (sessionID: string) => Effect.acquireRelease(Effect.sync(() => {
  const process = spawn("docker", ["events", "--since", String(Math.floor(Date.now() / 1000)), "--filter", `label=bymorning.session=${sessionID}`, "--filter", "event=start", "--format", "{{.Actor.ID}}"], { stdio: ["ignore", "pipe", "inherit"] })
  const lines = createInterface({ input: process.stdout })
  return { process, lines, iterator: lines[Symbol.asyncIterator]() }
}), ({ process, lines }) => Effect.sync(() => { lines.close(); process.kill() }))

for (const language of ["python", "javascript"] as const) {
  test(`the SDK runs real ${language}, persists its output artifact and retrieves it through Storage`, async ({ signal }) => {
    await Effect.runPromise(Effect.gen(function* () {
      const app = yield* TestApp.make({ execution: "docker" })
      const data = yield* ExecutionScenario.make(app, language, "ask")
      const source = yield* Effect.tryPromise(() => app.client.project.directory.read({ projectID: data.project.id, path: data.path }))
      expect(new TextDecoder().decode(source)).toBe(data.content)
      const script = yield* ExecutionScenario.script(app, data)
      const bus = yield* app.workspace({ account: data.account }, Bus.Service)
      const permissions = yield* bus.subscribe([SessionEvent.PermissionAsked])
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
      const pending = yield* permissions.pipe(Stream.filter((event) => event.data.sessionID === data.session.id), Stream.runHead)
      if (Option.isNone(pending)) throw new Error("Missing run permission request")
      const request = pending.value.data
      expect(request).toMatchObject({
        action: "execute",
        resources: [ProjectDirectory.resource(data.project.id, data.path)],
        metadata: { projectID: data.project.id, path: data.path, language },
        source: { type: "tool", callID: "run-docker" },
      })
      expect((yield* containers(data.session.id)).stdout.trim()).toBe("")
      yield* Effect.tryPromise(() => app.client.permission.reply({ sessionID: data.session.id, requestID: request.id, reply: "once" }))
      yield* app.llm.waitGate(script.gate)
      // The outer Tool scope has finished before the model is permitted to answer.
      expect((yield* containers(data.session.id)).stdout.trim()).toBe("")
      yield* app.llm.release(script.gate)
      yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
      const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
      const parts = messages.data.flatMap((message) => message.type === "assistant" ? message.content : [])
      const tool = parts.find((part) => part.type === "tool" && part.id === "run-docker")
      expect(tool).toMatchObject({ name: "run", state: { status: "completed", input: { path: data.path }, metadata: { truncated: true } } })
      if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("Missing completed run")
      expect(tool.state.result).toMatchObject({ stdout: ExecutionScenario.output, stderr: "", exitCode: 0 })
      const outputID = OutputID.make(String(tool.state.metadata?.outputID))
      const objects = yield* app.process(Storage.Service.use((storage) => storage.object.list(Storage.path("tool-output"))))
      const object = objects.find((item) => item.key.includes(outputID))
      expect(object).toBeDefined()
      if (!object) throw new Error("Missing stored Docker output")
      const stored = yield* app.process(Storage.Service.use((storage) => storage.object.get(Storage.path(...object.key.split("/")))))
      if (Option.isNone(stored)) throw new Error("Docker output is unavailable")
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(stored.value.body))).toBe(ExecutionScenario.output)
      expect(parts).toContainEqual(expect.objectContaining({ type: "text", text: script.answer }))
      // Retrieve a tail page through a second real SDK conversation, beyond the preview.
      yield* app.llm.expect(data.session.id, "assistant", [{
        expect: (request) => expect(request.tools?.some((tool) => tool.function.name === "tool_output")).toBe(true),
        response: { type: "success", events: [{ tool: { id: "retrieve-docker", name: "tool_output", input: { outputID, cursor: 51_000 } } }] },
      }, {
        expect: (request) => {
          const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "retrieve-docker")
          expect(JSON.stringify(result?.content)).toContain("docker artifact α")
          expect(JSON.stringify(result?.content)).not.toContain("unavailable")
        },
        response: { type: "success", events: [{ text: "Retrieved the stored execution output." }] },
      }])
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: "Retrieve the end of the stored execution output" }))
      yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
      const retrieved = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
      const retrieval = retrieved.data.flatMap((message) => message.type === "assistant" ? message.content : [])
        .find((part) => part.type === "tool" && part.id === "retrieve-docker")
      expect(retrieval).toMatchObject({
        state: {
          status: "completed",
          content: [{ type: "text", text: new TextDecoder().decode(new TextEncoder().encode(ExecutionScenario.output).subarray(51_000)) }],
        },
      })
      expect(JSON.stringify(retrieved)).toContain("Retrieved the stored execution output.")
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
    }).pipe(Effect.scoped), { signal })
  }, 90_000)
}

test("a real nonzero Python exit returns stdout/stderr to the model and removes its container", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const app = yield* TestApp.make({ execution: "docker" })
    const data = yield* ExecutionScenario.make(app, "error")
    const script = yield* ExecutionScenario.script(app, data, "error")
    yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
    yield* app.llm.waitGate(script.gate)
    expect((yield* containers(data.session.id)).stdout.trim()).toBe("")
    yield* app.llm.release(script.gate)
    yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
    const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
    const parts = messages.data.flatMap((message) => message.type === "assistant" ? message.content : [])
    expect(parts).toContainEqual(expect.objectContaining({ type: "tool", name: "run", state: expect.objectContaining({ status: "completed", result: { stdout: "before failure\n", stderr: "intentional stderr\n", exitCode: 7 } }) }))
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  }).pipe(Effect.scoped), { signal })
}, 90_000)

test("SDK interruption cancels an actually started Docker run and removes its container", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const app = yield* TestApp.make({ execution: "docker" })
    const data = yield* ExecutionScenario.make(app, "cancel")
    const script = yield* ExecutionScenario.script(app, data, "cancel")
    const events = yield* starts(data.session.id)
    yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
    const started = yield* Effect.tryPromise(() => events.iterator.next())
    expect(started.done).toBe(false)
    const inspected = yield* docker("inspect", started.value!)
    const [container] = JSON.parse(inspected.stdout)
    expect(container.State.Running).toBe(true)
    expect(container.Config.Labels["bymorning.session"]).toBe(data.session.id)
    expect(container.Config.User).toBe("1000:1000")
    expect(container.HostConfig.NetworkMode).toBe("none")
    expect(container.HostConfig.ReadonlyRootfs).toBe(true)
    yield* Effect.tryPromise(() => app.client.session.interrupt({ sessionID: data.session.id }))
    yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
    expect((yield* containers(data.session.id)).stdout.trim()).toBe("")
    const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
    expect(messages.data).toContainEqual(expect.objectContaining({ type: "assistant", error: expect.objectContaining({ _tag: "SessionError.AbortedError" }) }))
    expect(messages.data.flatMap((message) => message.type === "assistant" ? message.content : []))
      .toContainEqual(expect.objectContaining({ type: "tool", id: "run-docker", state: expect.objectContaining({ status: "error" }) }))
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  }).pipe(Effect.scoped), { signal })
}, 90_000)

test("a real background Shell survives the outer Tool and Run scopes until its Job is cancelled", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const app = yield* TestApp.make({ execution: "docker" })
    const data = yield* ExecutionScenario.make(app)
    const script = yield* ExecutionScenario.background(app, data)
    const events = yield* starts(data.session.id)
    yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
    const started = yield* Effect.tryPromise(() => events.iterator.next())
    expect(started.done).toBe(false)
    yield* app.llm.waitGate(script.gate)
    yield* app.llm.release(script.gate)
    yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
    const job = yield* app.workspace({ account: data.account }, Job.Service.use((jobs) => jobs.get(script.shellID)))
    expect(job).toMatchObject({ status: "running", type: "shell", metadata: { sessionID: data.session.id } })
    const [container] = JSON.parse((yield* docker("inspect", started.value!)).stdout)
    expect(container.State.Running).toBe(true)
    yield* app.workspace({ account: data.account }, Job.Service.use((jobs) => jobs.cancel(script.shellID)))
    yield* app.llm.wait(data.session.id, "assistant", 2)
    yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
    expect((yield* containers(data.session.id)).stdout.trim()).toBe("")
    expect(yield* app.workspace({ account: data.account }, Job.Service.use((jobs) => jobs.get(script.shellID)))).toMatchObject({ status: "cancelled" })
    const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
    expect(JSON.stringify(messages)).toContain("The background shell was cancelled.")
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  }).pipe(Effect.scoped), { signal })
}, 90_000)

test("a Shell call without an available Code Interpreter fails with plain text", async ({ signal }) => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const app = yield* TestApp.make()
    const data = yield* Chat.make(app)
    const script = yield* ExecutionScenario.unavailable(app, data)
    yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
    yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
    const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
    const tool = messages.data.flatMap((message) => message.type === "assistant" ? message.content : []).find((part) => part.type === "tool" && part.id === script.callID)
    expect(tool).toMatchObject({
      name: "shell",
      state: { status: "error", error: { message: "Shell failed: Code Interpreter is unavailable right now." } },
    })
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  })), { signal })
})
