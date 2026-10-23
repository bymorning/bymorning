# Browser tests against the Application

Run from `packages/web` with Bun, Node 22+, Docker, and Chromium available:

```sh
bun run test:application
```

To run one scenario or see the browser:

```sh
bun run test:application --grep 'reads a project file'
bun run test:application --headed --workers=1
```

The suite can use `/usr/bin/chromium` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
To install and select Playwright's browser instead:

```sh
bunx playwright install chromium
PLAYWRIGHT_MANAGED_CHROMIUM=1 bun run test:application
```

The fixture starts everything it owns. It requires no existing `bun dev`, SST,
AWS account, external authentication issuer, or model credentials. It never
restarts an existing app. Web and API listeners receive unused operating-system
ports. Each worker owns a PostgreSQL container, and each test receives its own
migrated database, Application, filesystem, model script, Vite origin, and browser
context. Closing the fixture removes these resources.

The browser uses the production Solid application and generated SDK. It signs in
through local login, receives real authentication cookies, opens the
scenario's persisted Session, and waits for its Message editor to be editable.
The Vite proxy sends requests to that test's actual Application. Tests do not
replace API responses, Session history, event streams, or the frontend SDK.
The suite covers a successful file read, a missing-file Tool failure, stream
cancellation, and a Provider authentication failure. Each case checks persisted
behavior after reload.

## Adding a scenario

Import `test` and `expect` from `e2e/fixtures/app`. The `app` fixture exposes the
shared `TestApp` methods, the `Chat.make` scenario as `app.data`, and the web origin
as `app.web`. Reuse scenarios in `packages/testing/src/scenario` so backend, SDK, and browser
tests exercise the same persisted setup and model expectations.

For a conversation, install the model script before submitting through the
Message combobox and Send button. Wait for a named model gate when you need to
inspect an intermediate state; release it after the assertion. For cancellation,
wait for the response's cancellation gate, then click the actual Stop button.
Fixture cleanup checks that every required model request was consumed and that
no request violated its expected content.

Assert the behavior the user observes: the real Tool output or failure, the final
answer appearing once, the running state ending, and the same conversation after
reload. The model's second request should also assert the actual Tool result;
displaying a scripted final sentence alone does not prove that the Tool worked.
SDK reads can confirm persisted state alongside browser assertions.

Use role, label, text, or an explicit component contract to locate the unique
element. Await web assertions for readiness. Register a request or event wait
before triggering it. Do not synchronize with sleeps, `waitForTimeout`, or retry
state-changing actions. See Playwright's [best practices](https://playwright.dev/docs/best-practices),
[assertions](https://playwright.dev/docs/test-assertions), and
[isolation](https://playwright.dev/docs/browser-contexts) guidance.

Keep small component tests for presentation-only loading/error cases. Use this
suite for behavior that depends on authentication, backend state, real Tools,
streaming events, or persistence. Native provider protocol and code execution
adapters still require their own focused tests; the chat scenario controls an
OpenAI-compatible model endpoint and exercises real Project file Tools.

## Failures

Playwright saves screenshots and traces under `packages/web/test-results/application`.
Open a trace from the web package with `bunx playwright show-trace <trace.zip>`.
Inspect the first UI or model-script assertion, along with Application logs.
Fix the failing contract before adding retries. Increasing `--workers` preserves
isolation but consumes more Docker, Vite, and browser resources.

Run `bun typecheck` from `packages/web` when changing the fixture or its tests. It
checks the production frontend with its strict settings, then checks the
Application tests with the backend settings in `e2e/application/tsconfig.json`.
The Playwright command loads `tsx` because the running backend and its external
dependencies use the same TypeScript/module resolution as local development.
