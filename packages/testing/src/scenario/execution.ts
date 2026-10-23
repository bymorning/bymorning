/** Real built-in run conversations; no replacement Tools or interpreter. */
export * as ExecutionScenario from "./execution.js"

import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Effect } from "effect"
import assert from "node:assert/strict"
import type { TestApp } from "../application.js"
import { Chat } from "./chat.js"

export const output = "docker artifact α\n".repeat(3_000)

/** The source is persisted in the Session's Project, not on the host filesystem. */
// run returns stdout/stderr, not downloadable files: artifact.txt stays ephemeral;
// its emitted bytes become the durable ToolOutput artifact tested by this scenario.
export const make = Effect.fn("ExecutionScenario.make")(function* (
  app: TestApp.Interface,
  kind: "python" | "javascript" | "error" | "cancel" = "python",
  permission: "allow" | "ask" = "allow",
) {
  const content = kind === "javascript"
    ? `import { writeFileSync, readFileSync } from "node:fs";
if (process.cwd() !== "/work" || process.getuid() !== 1000) throw new Error("Wrong execution environment");
writeFileSync("artifact.txt", ${JSON.stringify(output)});
process.stdout.write(readFileSync("artifact.txt"));`
    : kind === "error"
      ? 'import sys\nprint("before failure", flush=True)\nprint("intentional stderr", file=sys.stderr)\nsys.exit(7)'
      : kind === "cancel"
        ? "import signal\nsignal.pause()"
        : `import os
from pathlib import Path
assert os.getcwd() == "/work"
assert os.getuid() == 1000
Path("artifact.txt").write_text("docker artifact α\\n" * 3000)
print(Path("artifact.txt").read_text(), end="")`
  const data = yield* Chat.make(app, { path: kind === "javascript" ? "source/main.js" : "source/main.py", content })
  const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
  yield* Effect.tryPromise(() => app.client["api.config"].update({
    ...config,
    permissions: [{ action: "execute", resource: ProjectDirectory.resource(data.project.id, data.path), effect: permission }],
  }))
  return data
})

/** Assert the actual offered schema and the actual next request's Tool result. */
export const script = Effect.fn("ExecutionScenario.script")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  kind: "success" | "error" | "cancel" = "success",
) {
  const prompt = `Run ${data.path} in the isolated interpreter`
  const gate = `${data.session.id}:execution-result`
  const answer = kind === "error" ? "The program exited with an error." : "The real program completed."
  yield* app.llm.expect(data.session.id, "title", [{
    expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompt)),
    response: { type: "success", events: [{ text: "Execute Project source" }] },
  }])
  yield* app.llm.expect(data.session.id, "assistant", [{
    expect: (request) => {
      assert.ok(request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt)))
      const run = request.tools?.find((tool) => tool.function.name === "run")
      assert.ok(run, "The registered built-in run must be offered directly, not replaced by a fixture Tool")
      const parameters = run.function.parameters
      assert.ok(parameters !== null && typeof parameters === "object" && "required" in parameters)
      assert.deepEqual(parameters.required, ["path"])
      assert.ok(request.tools?.some((tool) => tool.function.name === "execute"), "Code Mode remains enabled")
    },
    response: { type: "success", events: [{ tool: { id: "run-docker", name: "run", input: { path: data.path } } }] },
  }, ...(kind === "cancel" ? [] : [{
    expect: (request: import("../llm.js").Request) => {
      const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "run-docker")
      assert.ok(result, "The next request must contain the actual Docker result")
      const text = JSON.stringify(result.content)
      if (kind === "error") {
        assert.ok(text.includes("before failure"), text)
        assert.ok(text.includes("intentional stderr"), text)
      } else {
        assert.ok(text.includes("docker artifact α"), text)
        assert.ok(text.includes("full content saved as out_"), text)
      }
    },
    response: { type: "success" as const, events: [{ gate }, { text: answer }] },
  }])])
  return { prompt, gate, answer }
})

/** A Job-owned Shell must outlive the Tool call and report cancellation synthetically. */
export const background = Effect.fn("ExecutionScenario.background")(function* (app: TestApp.Interface, data: Chat.Data) {
  const prompt = "Start an isolated background shell"
  const gate = `${data.session.id}:shell-running`
  const shellID = "background-docker"
  const command = "python3 -c 'import signal; signal.pause()'"
  yield* app.llm.expect(data.session.id, "title", [{
    expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompt)),
    response: { type: "success", events: [{ text: "Background Docker shell" }] },
  }])
  yield* app.llm.expect(data.session.id, "assistant", [{
    expect: (request) => assert.ok(request.tools?.some((tool) => tool.function.name === "shell")),
    response: { type: "success", events: [{ tool: { id: shellID, name: "shell", input: { command, background: true } } }] },
  }, {
    expect: (request) => {
      const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === shellID)
      assert.ok(JSON.stringify(result?.content).includes("running in the background"))
    },
    response: { type: "success", events: [{ gate }, { text: "The shell continues in its own Job." }] },
  }, {
    expect: (request) => {
      assert.ok(request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes('state=\\"cancelled\\"')))
    },
    response: { type: "success", events: [{ text: "The background shell was cancelled." }] },
  }])
  return { prompt, gate, shellID }
})

/** Without an installed Code Interpreter, a Shell call must fail with plain, ID-free text. */
export const unavailable = Effect.fn("ExecutionScenario.unavailable")(function* (app: TestApp.Interface, data: Chat.Data) {
  const prompt = "Run echo hello in a shell"
  const callID = "shell-unavailable"
  const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
  yield* Effect.tryPromise(() => app.client["api.config"].update({
    ...config,
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
  }))
  yield* app.llm.expect(data.session.id, "title", [{
    expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompt)),
    response: { type: "success", events: [{ text: "Run a shell command" }] },
  }])
  yield* app.llm.expect(data.session.id, "assistant", [{
    expect: (request) => assert.ok(request.tools?.some((tool) => tool.function.name === "shell")),
    response: { type: "success", events: [{ tool: { id: callID, name: "shell", input: { command: "echo hello" } } }] },
  }, {
    expect: (request) => {
      const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === callID)
      assert.ok(result, "The next request must contain the Shell failure")
      assert.equal(result.content, `Shell failed: ${CodeInterpreter.UNAVAILABLE_MESSAGE}`)
    },
    response: { type: "success", events: [{ text: "The interpreter is unavailable." }] },
  }])
  return { prompt, callID }
})
