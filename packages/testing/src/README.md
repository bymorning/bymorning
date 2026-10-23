# Testing the real Application

Use this harness for behavior that crosses Core services, PostgreSQL, authentication,
HTTP, the generated SDK, or the web application. It constructs the production
`Application` with disposable local resources and a scripted external model endpoint.
Session execution, Tools, permissions, persistence, and event delivery stay real.

The SDK is the normal `ByMorningClient`. The fixture changes its base URL and supplies
an isolated cookie jar; it does not implement another set of API responses.

## Run the tests

Install repository dependencies with Bun and have Node 22+ and Docker available.
Each `vitest` run starts one `postgres:17-alpine` container (pulled from the public
ECR mirror on a cold host). No running `bun dev`, SST, AWS credentials, external
issuer, ambient `DATABASE_URL`, or model API key is required. The fixtures allocate
their own ports and do not restart an existing application.

From `packages/testing/`:

```sh
bun run test -- test/chat.test.ts
bun run test -- test/sdk.test.ts test/application.test.ts
bun run test -- test/database.test.ts test/llm.test.ts graph.test.ts
bun typecheck
```

`bun run test` runs the complete app package, including the existing local startup
and configuration tests. From `packages/web/`:

```sh
bun run test:application
bun run typecheck:application
```

The browser suite needs Chromium. It uses `/usr/bin/chromium` when present, accepts
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, or can use Playwright's managed installation:

```sh
bunx playwright install chromium
PLAYWRIGHT_MANAGED_CHROMIUM=1 bun run test:application
```

Run tests and typechecks from the package that owns them. Start with the affected
scenario, then run the relevant suite. See [the browser guide](BROWSER.md) for headed
runs, filtering, traces, and browser test conventions.

## Fixture entrypoints

Import the owning module, for example
`@bymorning/testing/application` or `../src/application.js` from `packages/testing/test/`.

| Entry                                              | Contract                                                                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestApp.make(options?)`                           | Scoped acquisition of one blank, running Application. Options are `database`, `appOrigin`, `execution`, `storage` (typed Storage construction), `plugins` (additional persisted plugin entries), and `parent` (where the resource directory is created; pass `TestApp.repository` when the model writes Project plugins, because Vite resolves their `effect` and `@bymorning/plugin` imports only beneath the repository). |
| `app.login()`                                      | Follow the real local callback, retain SDK cookies, provision/select the owner, and persist offline configuration before first Workspace activation. Returns the selected `UserActor`.               |
| `app.process(effect)`                              | Run an Effect using this Application's existing process services: Database, Storage, Account, User, Auth, Workspace, and WorkspaceMap.                                                               |
| `app.workspace({ account, workspaceID? }, effect)` | Use real membership selection and this Application's retained WorkspaceMap. Existing domain errors remain typed.                                                                                     |
| `app.client`                                       | Normal generated Promise SDK, directed at `app.origin`, with the fixture's authenticated cookies after login.                                                                                        |
| `app.llm`                                          | Script expectations and control the local inference endpoint.                                                                                                                                        |
| `app.origin` / `app.directory`                     | Actual API URL and temporary resource directory. Both belong to the fixture scope.                                                                                                                   |

Bedrock Gateway scenarios use `Bedrock.make()` from `src/scenario/bedrock.ts`.
It seeds connections and service keys through the real generated SDK and starts
`TestBedrock`, an external HTTP server with AWS binary eventstream and Mantle SSE
fixtures. `TestApp.make({ outbound })` replaces only the graph's HTTP adapter;
the real resolver constructs and signs the canonical AWS request before that
adapter directs it to the fixture. Gateway's package client has a fresh Layer
scope so Session's separately configured package client cannot capture this
transport. No API responses or Core services are fabricated.

`make()` starts with an empty database and an unauthenticated SDK. Ordinary scenarios
call `app.login()` or `Chat.make(app)`. Protected routes still require authentication;
tests for unauthenticated responses can call the blank fixture before login. Directly
calling `Auth.resolve` does not apply the fixture's offline Workspace configuration.

Each Application owns a separate migrated database, filesystem Storage,
cookie key, model controller, API listener, and runtime. The fixture supplies an empty
Effect ConfigProvider and disables package installation. Its login setup installs the
local model-routing plugin through persisted Config. No seed, reset, or model-control
HTTP endpoints are added to the app.

The default Storage factory uses a fixture-owned temporary directory. Pass `storage:
Storage.Options` to exercise explicit provider selection or acquisition failures. Storage
owns acquired provider resources; the supplying test scope cleans up any external directories.
`StorageScenario.reload(app)` exercises the Promise plugin loader, persistent plugin
state, SDK configuration/reload, and SDK-visible Agent contribution. Install
`StorageScenario.plugin` through the fixture's `plugins` option before running it.

`PluginAuthoring.script(app, data, { content, prompt, inspect })` scripts the model
writing a Project plugin entrypoint, reading the write result, and verifying the real
inventory through Code Mode (`toolkit.plugin.list`) on the next assistant execution;
`inspect` receives the rows the model saw. `PluginAuthoring.probe(app, data)` is the
Bymorning Skill's own template read through the Skill service, and
`PluginAuthoring.broken` is an entrypoint that cannot be imported. Create the
Application with `parent: TestApp.repository` for these scenarios.
`PluginAuthoring.install(app, data, files)` writes entrypoints through the SDK
Project File API and follows `plugin.updated` Events until the inventory reports
each path, failing as a reload storm past a bound; `PluginAuthoring.reloads(app,
data, action, until)` counts `plugin.updated` Events while `action` runs.
`PluginAuthoring.incident` is a verbatim production plugin whose OAuth method has
no `authorize` function, and `PluginAuthoring.sibling` is a valid key-method plugin.

## Reuse persisted scenarios

Place scenario modules under `packages/testing/src/scenario/`. A scenario is an Effect function
over `TestApp.Interface` that returns its own typed data; there is no giant optional
fixture-data object. Seed through public services. Use direct SQL for migration tests,
deliberately malformed or legacy rows, and database-specific assertions.

`Chat.make(app, { path?, content? })` performs real login, connects a dummy fixture
credential to the test model, selects its model policy, creates a Project, writes a
Project file, and creates a Session. The defaults are `notes.txt` and `hello`. It returns
`owner`, `account`, `project`, `session`, `path`, and `content`.

`Chat.script(app, data, kind?)` registers the model requests for a fresh conversation
and returns its prompt, expected answer, and synchronization gate. Supported kinds:

| Kind             | Model behavior                                                                                              | Application behavior to assert                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `read` (default) | Request the real `read` Tool; assert its result in the next model request; pause before answering.          | Persisted Tool result, file content, final answer, and idle Session.                                  |
| `missing`        | Request `missing.txt`; assert the real failure in the next model request; pause before the recovery answer. | Recorded Tool failure and recovery answer.                                                            |
| `cancel`         | Stream partial text and remain active at a cancellation gate.                                               | Actual Session interruption, settled model request, and durable partial history.                      |
| `provider`       | Return HTTP 401 with a fixture error.                                                                       | Production provider failure classification and Session outcome. This response has no releasable gate. |

These scripts include a separate title-generation expectation. Install a script before
submitting the prompt. For additional turns or different data, register explicit model
expectations instead of repeatedly applying a fresh-conversation script to an existing
Session.

## Backend test

This example can live in `packages/testing/test/`. The assertions read current
persisted Messages through the same Session service used by HTTP handlers:

```ts
import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("reads a real Project file", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app, { content: "fixture content" })
      const script = yield* Chat.script(app, data)
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
      const messages = yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.messages({ sessionID: data.session.id, order: "desc", limit: 200 })),
      )
      expect(
        messages.some(
          (message) =>
            message.type === "assistant" &&
            message.content.some((part) => part.type === "text" && part.text === script.answer),
        ),
      ).toBe(true)
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 60_000)
```

`Chat.script` also asserts that the next actual model request contains the `read-1`
result. A scripted final sentence alone would not prove that Tool execution worked.
Add assertions for the specific persisted Tool parts or events relevant to your test.

Pass Vitest's test-context `signal` into `Effect.runPromise`. A test timeout must
interrupt the scoped Effect so Application fibers, listeners, and databases can close;
Vitest timing out an unrelated Promise does not itself dispose those resources.

## SDK and browser tests

Within the same fixture, submit through `app.client.session.prompt` and read
current Messages through `app.client.message.list`. The response contains
opaque HTTP cursors; pass `cursor.next` or `cursor.previous` back unchanged for
another page. Execute this Effect inside the owning fixture scope:

```ts
const conversation = Effect.gen(function* () {
  yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
  yield* app.llm.waitGate(script.gate)
  yield* app.llm.release(script.gate)
  yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
  )
  return yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
})
```

SDK prompt success means the prompt was admitted; it does not mean the Run has
completed. Wait for the intended lifecycle/event or use `Session.awaitIdle`
through `app.workspace` before asserting final state. The live Event stream at
`/api/event` starts with `server.connected` and has no replay, so reconnect
tests must re-read current resources. Use `app.client.session.interrupt` to
exercise the real cancellation route.

Browser tests import `test` and `expect` from `packages/web/e2e/fixtures/app`. That
fixture adds `app.data` from `Chat.make` and `app.web`, starts Vite against the test's
API, signs in through local login, and opens the persisted Session. Each test
has an isolated browser context. Register `Chat.script` before sending through the
actual Message editor. Assert Tool states, the final answer appearing once, completed
activity, and persistence after reload. The existing
[browser conversation tests](../../packages/web/e2e/application/chat.spec.ts) demonstrate
read success, missing-file failure, cancellation, and provider authentication failure.

## Script the external model

The fixture plugin redirects `session.model.request` through the supported hook and
sends Session/purpose correlation headers. `TestLLM` implements OpenAI-compatible
Chat Completions; the production Provider still formats requests, decodes responses,
and classifies errors.

| Operation                                    | Behavior                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `llm.expect(sessionID, purpose, steps)`      | Append required request assertions and responses for that Session and purpose.                                     |
| `llm.wait(sessionID, purpose, index = 0)`    | Await actual receipt of one registered request; indexes are zero-based within that script.                         |
| `llm.settled(sessionID, purpose, index = 0)` | Await completion/interruption of that response. This does not itself prove the Session is idle.                    |
| `llm.waitGate(name)`                         | Await the point where the response reaches a named gate.                                                           |
| `llm.release(name)`                          | Release an ordinary success-response gate.                                                                         |
| `llm.list()`                                 | Return parsed actual requests for additional assertions.                                                           |
| `llm.verify()`                               | Fail for mismatches, unexpected requests, or unfinished/unconsumed required steps. Also runs during scope cleanup. |

Purposes are `assistant`, `title`, `compaction`, and `generate`. Scripts are keyed by
Session and purpose, so background title generation cannot consume an assistant
response. Register all requests your scenario can cause. Gate names must be unique
within one Application.

Every step has `expect(request)` and `response`. Assertions can inspect the actual
`model`, `messages`, offered `tools`, `stream`, `sessionID`, and `purpose`:

```ts
const configure = Effect.gen(function* () {
  yield* app.llm.expect(data.session.id, "assistant", [
    {
      expect: (request) => {
        expect(request.tools?.some((tool) => tool.function.name === "read")).toBe(true)
      },
      response: {
        type: "success",
        events: [
          { reasoning: "Inspect the Project file." },
          { tool: { id: "read-1", name: "read", input: { path: data.path } } },
        ],
        usage: { input: 20, output: 8 },
      },
    },
  ])
})
```

Yield `configure` from the scenario before submitting its prompt. Register the
corresponding title response and the next assistant response when this
is a fresh conversation. Assert the real Tool result in that second request.

Success events support `text`, `reasoning`, `tool`, and `gate`. Other response variants
are `error` with HTTP status/message, `cancel` with a gate and optional partial text,
`malformed` with raw data, and `truncated` with partial text chunks and no stream finish.
A cancellation gate remains blocked until the actual caller interrupts the request;
calling `release` is not a substitute for testing cancellation.

Synchronize using these gates, request receipt, domain events, and UI readiness. Do
not use sleeps or retry mutations. Await background title completion when verifying
the entire script. A model assertion failure is retained even if Session catches the
resulting HTTP error, so cleanup still fails the test.

## One PostgreSQL server per run

`packages/testing/src/database.ts` is the only PostgreSQL bootstrap. The Vitest
`globalSetup` in `src/vitest/global-setup.ts` (wired into the `vitest.config.ts` of
`packages/testing`, `packages/server`, and `packages/core`'s integration config)
starts one `postgres:17-alpine` container, runs the production migrator into
`template_bymorning`, confirms that template has no live backends, and publishes the
admin URL to the workers through `BYMORNING_TEST_PG_URL`. Teardown removes the
container and its volume.

`TestDatabase.shared` is that server. `create()` is `CREATE DATABASE ... TEMPLATE
template_bymorning`, so every Application and every PostgreSQL suite receives its own
migrated database in milliseconds, and the database is dropped (`WITH (FORCE)`) when the
creating scope closes. `create({ empty: true })` hands out a blank database for tests of
the migrator itself. `TestApp.make()` without a `database` option uses `shared`;
committed state never crosses databases, so files no longer need a per-worker scope:

```ts
import { Effect } from "effect"
import { TestApp } from "./application.js"

await Effect.runPromise(
  Effect.gen(function* () {
    const app = yield* TestApp.make()
    yield* app.login()
    // Exercise this Application here. Its scope owns its database and files.
  }).pipe(Effect.scoped),
)
```

Suites that build `Database.node` from `DATABASE_URL` (the Core integration files) use
the `src/vitest/file-database.ts` setup file, which clones one database per test file
and sets `DATABASE_URL` before the file's imports run. Those files bind the unbound
process seams (Database, Audit, Storage, Cipher) through
`packages/core/test/integration/graph.ts`: `compile(graph)` applies the test host
adapters to any Core node graph and `database` is the file's database as a Layer.

When a file runs without its package config (`BYMORNING_TEST_PG_URL` unset), `shared`
starts one container for that process, prints a note, and removes it at exit.
`TestDatabase.make` remains the low-level per-scope container for runners without a
Vitest global setup, such as the Playwright worker fixtures; its `create()` migrates
each database individually and closing its scope removes the container.

Docker readiness uses bounded live polling. Acquire the fixture with
`Effect.runPromise` or a live test runtime; an unadvanced `TestClock` cannot drive
external PostgreSQL startup. Tests synchronize on completed acquisition instead
of adding sleeps.

## Execution profiles and limits

The default `execution: "disabled"` installs the existing unavailable CodeInterpreter.
The chat scenarios use actual Project file Tools and do not require the execution
image. For tests of Python, JavaScript, TypeScript, or shell execution, select
`TestApp.make({ execution: "docker" })` after building the local image from the root:

```sh
docker build --tag bymorning-code-interpreter:local --file app/host/Dockerfile.execution .
```

The harness does not build that image automatically. Keep actual code-execution
coverage in the Docker profile; an unavailable adapter is not execution coverage.

The model fixture covers the selected OpenAI-compatible wire format. Native provider
protocols retain their focused adapter tests. New external MCP, OAuth, reference, or
plugin scenarios must explicitly select local fixtures for their external calls; an
empty ConfigProvider is not a network sandbox, and shell subprocesses can inherit
environment variables. Do not supply real secrets to make a deterministic test pass.

Command shell interpolation uses the selected Application directory, so fixture
commands start in `app.directory`. This sets their working directory; it does not
restrict explicitly chosen paths or sandbox arbitrary plugin code.

This harness is a source test runner, not a compiled standalone application or a
deployment parity test. Keep focused unit tests when they add useful coverage for
pure behavior or presentation. Place cross-service application tests under `packages/testing/test/`
and real frontend flows under `packages/web/e2e/application/`.

When a test fails, inspect the first domain, SDK, UI, or `ScriptError` assertion.
`SetupError` identifies acquisition failures, including Application startup defects
reported at the `application` stage; `RequestError` identifies fixture
login/transport failures. Expected HTTP/domain failures remain observable through
their normal interfaces. Dispose fixture scopes in `finally`; do not manually delete
shared tables or clear the developer database.
