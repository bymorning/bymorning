/** Model-driven Project plugin authoring: write an entrypoint, then read the real inventory on the next turn. */
export * as PluginAuthoring from "./plugin-authoring.js"

import { Plugin } from "@bymorning/core/plugin"
import type { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Skill } from "@bymorning/core/skill"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { TestApp } from "../application.js"
import type { Chat } from "./chat.js"
import { ProjectFile } from "./project-file.js"

/** The entrypoint path the Skill names for its probe. */
export const path = "plugin/probe.ts"

/**
 * The Skill's own "Create a plugin" template with the probe ID it prescribes, read
 * through the public Skill service so the scenario exercises the text the model sees.
 */
export const probe = Effect.fn("PluginAuthoring.probe")(function* (app: TestApp.Interface, data: Chat.Data) {
  const skill = yield* app.workspace(
    { account: data.account },
    Skill.Service.use((skills) => skills.get("bymorning" as never)),
  )
  const section = skill.instructions.split("## Create a plugin")[1]
  const block = section?.match(/```ts\n([\s\S]*?)```/)?.[1]
  assert.ok(block, "The Bymorning Skill must carry its plugin template")
  assert.ok(block.includes('id: "project.example"'), block)
  return block.replace('id: "project.example"', 'id: "project.probe"')
})

/** A plugin entrypoint that cannot be imported: the closing of the definition is missing. */
export const broken = `import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.broken",
  effect: () => Effect.void,
`

/**
 * A chat agent's production Project plugin, verbatim: it registers an OAuth Integration method
 * without the required `authorize` function, so the host must reject it as that plugin's failure.
 */
export const incident: ProjectFile.Write = {
  path: "plugin/google-workspace.ts",
  content: readFileSync(new URL("./fixture/google-workspace.ts.txt", import.meta.url), "utf8"),
}

/** The inventory error the host reports for `incident`. */
export const incidentError = "OAuth method oauth for integration google-workspace needs an authorize function"

/** A valid sibling Project plugin: a key-method Integration and one Tool that uses it. */
export const sibling: ProjectFile.Write = {
  path: "plugin/jira-my-issues.ts",
  content: `import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "project.jira-my-issues",
  effect: (context) =>
    Effect.all(
      [
        context.integration.transform((editor) => {
          editor.update("jira", (integration) => {
            integration.name = "Jira"
          })
          editor.method.update({ integrationID: "jira", method: { type: "key", label: "API token" } })
        }),
        context.tool.transform((editor) => {
          editor.add({
            name: "jira_my_issues",
            description: "List the Jira issues assigned to me.",
            input: Schema.Struct({}),
            output: Schema.Unknown,
            options: { permission: "jira" },
            execute: () => Effect.succeed({ output: [] }),
          })
        }),
      ],
      { discard: true },
    ),
})
`,
}

/** The live Workspace Event stream; it has no replay, so each reader waits for `server.connected`. */
const events = (app: TestApp.Interface, data: Chat.Data) =>
  Stream.fromAsyncIterable(
    app.client.event.subscribe({ workspace: data.owner.properties.workspaceID }),
    (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
  )

/**
 * Write Project plugin entrypoints through the real Project File API, then follow `plugin.updated`
 * Events until the Plugin inventory reports every written path. More than `bound` Events before
 * the inventory settles fails as a reload storm. Returns the settled inventory and Event count.
 */
export const install = Effect.fn("PluginAuthoring.install")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  files: readonly [ProjectFile.Write, ...ProjectFile.Write[]],
  bound = 6,
) {
  const connected = yield* Deferred.make<void>()
  let updates = 0
  const reported = (rows: ReadonlyArray<PluginSchema.Info>) =>
    files.every((file) => rows.some((row) => row.source.type === "project" && row.source.path === file.path))
  const settled = yield* events(app, data).pipe(
    Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
    Stream.filter((event) => event.type === "plugin.updated"),
    Stream.mapEffect(() =>
      Effect.gen(function* () {
        updates++
        assert.ok(updates <= bound, `Reload storm: ${updates} plugin.updated Events before the inventory settled`)
        return yield* app.workspace({ account: data.account }, Plugin.Service.use((plugin) => plugin.list()))
      }),
    ),
    // End on a delivered Event: interrupting a pending SDK read can outlive the scope.
    Stream.takeUntil(reported),
    Stream.runLast,
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* Deferred.await(connected)
  yield* ProjectFile.seed(app, data, files)
  const rows = Option.getOrThrow(yield* Fiber.join(settled))
  return { rows, updates }
})

/**
 * Run `action` and count the `plugin.updated` Events published until the first Event matching `until`.
 * Reconciliation is quiet when nothing changed, so a settled Workspace reports zero.
 */
export const reloads = Effect.fn("PluginAuthoring.reloads")(function* <E>(
  app: TestApp.Interface,
  data: Chat.Data,
  action: Effect.Effect<void, E>,
  until: (event: { readonly type: string; readonly data: unknown }) => boolean,
) {
  const connected = yield* Deferred.make<void>()
  const counted = yield* events(app, data).pipe(
    Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
    Stream.takeUntil(until),
    Stream.runFold(
      () => 0,
      (count, event) => (event.type === "plugin.updated" ? count + 1 : count),
    ),
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* Deferred.await(connected)
  yield* action
  return yield* Fiber.join(counted)
})

/** Parsed inventory row as the model receives it through Code Mode. */
export interface Row {
  readonly id?: string
  readonly source: { readonly type: string; readonly path?: string; readonly projectID?: string }
  readonly status: "active" | "failed"
  readonly error?: string
  readonly ref?: string
  readonly tools?: ReadonlyArray<string>
  readonly integrations?: ReadonlyArray<string>
}

/** The Code Mode call the Skill prescribes for verification. */
export const code = 'return await tools.toolkit.plugin.list({ source: "project" })'

/** Decode the Code Mode result delivered to the next model request into inventory rows. */
export const rows = (content: unknown): ReadonlyArray<Row> => {
  // The Session hands the Tool's text content to the Provider; OpenAI format carries it
  // either as one string or as text parts. Code Mode prints the returned value as JSON.
  const text = Array.isArray(content)
    ? content
        .map((part: unknown) =>
          typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "",
        )
        .join("")
    : typeof content === "string"
      ? content
      : JSON.stringify(content)
  const start = text.indexOf("{")
  assert.ok(start >= 0, text)
  const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as { plugins: ReadonlyArray<Row> }
  return parsed.plugins
}

/**
 * Register a three-step conversation: the model writes `content` to `path`, reads the
 * write result, verifies through `toolkit.plugin.list` on the next execution, and answers.
 * `inspect` receives the real inventory rows the model saw.
 */
export const script = Effect.fn("PluginAuthoring.script")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  input: {
    readonly content: string
    readonly prompt: string
    readonly inspect: (rows: ReadonlyArray<Row>, request: import("../llm.js").Request) => void
  },
) {
  const answer = "Verified the plugin inventory."
  const gate = `${data.session.id}:plugin-authoring`
  yield* app.llm.expect(data.session.id, "title", [
    {
      expect: (request) =>
        assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(input.prompt))),
      response: { type: "success", events: [{ text: "Author a Project plugin" }] },
    },
  ])
  yield* app.llm.expect(data.session.id, "assistant", [
    {
      expect: (request) => {
        assert.ok(request.tools?.some((tool) => tool.function.name === "write"), "The real write Tool must be offered")
        assert.ok(request.tools?.some((tool) => tool.function.name === "execute"), "Code Mode must be offered")
        const system = request.messages
          .filter((message) => message.role === "system" || message.role === "developer")
          .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
          .join("\n")
        assert.ok(
          system.includes("The member you are assisting has the admin Role in this Workspace"),
          "The system prompt must carry the member's Role from the bound member graph",
        )
        assert.ok(
          system.includes(`Integrations: a Console page at /w/${data.owner.properties.workspaceID}/mcp`),
          "The system prompt must name the real Integrations page",
        )
        assert.ok(system.includes("toolkit.plugin.list"), "Code Mode catalog must advertise the inventory Tool")
      },
      response: {
        type: "success",
        events: [{ tool: { id: "write-1", name: "write", input: { path, content: input.content } } }],
      },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "write-1")
        assert.ok(result, "The next model request must include the real write-1 result")
        const text = JSON.stringify(result.content)
        assert.ok(text.includes(`Wrote Project File: @${path}`), text)
        assert.ok(text.includes("activates before the next assistant turn"), text)
        assert.ok(text.includes("toolkit.plugin.list"), text)
      },
      response: {
        type: "success",
        events: [{ tool: { id: "list-1", name: "execute", input: { description: "Verify plugin activation", code } } }],
      },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "list-1")
        assert.ok(result, "The next model request must include the real inventory result")
        input.inspect(rows(result.content), request)
      },
      response: { type: "success", events: [{ gate }, { text: answer }], usage: { input: 12, output: 6 } },
    },
  ])
  return { answer, gate }
})
