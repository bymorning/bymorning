# ByMorning Starter

A small independent Solid SPA demonstrating the public `@bymorning/client/solid` data
contract. `src/entry.tsx` renders the auth/application root. Each authenticated
origin, identity generation, and workspace creates a `ServerProvider` scope in
`src/runtime/server/`: it constructs Connection then Data, owns explicit catalog
and selected-session recovery, and evicts only the prior selected session.

## Application foundation

The application composes providers, persistent shell chrome, and workspace-scoped routes:

```text
App (ThemeProvider, I18nProvider)
└── WorkspaceProvider — discovery, auth generation, URL workspace selection
    └── Routes / LayoutProvider — responsive layout and in-memory rail state
        └── Shell — persistent Titlebar, desktop navigation mount, content, Toast.Region
            └── ClientScope / ServerProvider — keyed by origin, identity, workspace
                └── HomeRoute — session selection, navigation, conversation
```

`Shell` accepts children only. `Titlebar` reads workspace and layout state from
their providers; application controls are not threaded through runtime components.
`HomeRoute` portals its navigation into the desktop rail or mobile drawer, retaining
the route's Solid owner and workspace-scoped Data. Shell chrome and rail width
survive workspace/session navigation; only the matching runtime subtree resets.
The mobile breakpoint is 768px and rail bounds are 140–520px. Width and
drawer state are not persisted.

The drawer uses a registered trigger, force-mounted Portal/Content,
presence-managed Overlay, transform transitions, and reduced-motion rules.
A Corvu dependency patch (`patches/@corvu%2Fdrawer@0.2.4.patch`) fixes an
immediate-open/Escape race in the drawer's deferred transition callbacks.

## Data and features

TanStack Query is limited to the pre-workspace discovery and the file surface.
Every file key starts with origin, identity generation, and workspace; no key
contains credentials. Query retries and automatic focus, mount, and reconnect
refetches are disabled. `ServerSync.queryReady()` is an application file gate:
it closes on transport loss and opens only after the appropriate bootstrap or
recovery phase. On a later stream connection, the application invalidates
the scoped file keys without fetching, explicitly recovers Data, then its
explicit recovery targets only active directory/content observers. A file model
keeps an already activated project query enabled through the temporary gate
closure; an offline project selection waits for the gate and makes one initial
request after recovery. Scope disposal first closes recovery,
awaits Query cancellation, clears its cache, and then disposes Connection/Data.
`directoryQuery` and `contentQuery` are feature-local; filtering is local over
the listed paths and never requests a server search. The editor refuses invalid
UTF-8 and control-byte content rather than corrupting binary files, and edits
real text payloads only. File writes use TanStack's native mutation state scoped
to the affected file rather than a second write cache. Data remains the owner of
conversation projection, submissions, and timeline inputs; the application
retains the Message, Inbox, then local Submission presentation order.

The Session view is composed from `@bymorning/session-ui`. The starter owns the
Data-backed row precedence, selected-session actions, mutation state, and form
answers; the package renders those explicit inputs. Its token and component
styles are imported by `src/entry.tsx`, while `src/style.css` remains limited to
the application shell, navigation, connection, and file browser.

The Starter wires the existing prompt, Stop, Compact, agent, and model controls,
plus Permission and Form actions. It does not demonstrate uploads, command
execution, session renaming, or resource navigation as package-owned behavior.

The Markdown renderer uses an ESM module worker. Starter configures Vite worker
output as `es`, which is required for its worker chunk imports in both dev and
production builds. This worker configuration is a host requirement; it does not
make Markdown SSR-safe.

For interactive development, point Vite at an already configured local
Application. Its configured callback origin must allow the Vite browser origin;
the SPA does not contain a production API URL or restart backend processes.

```sh
VITE_API_ORIGIN=http://localhost:3210 bun run dev
bun run typecheck
bun run build
bun run test:application
# Run the production-build streaming benchmark through the same isolated harness.
STARTER_E2E_BUILD=1 STARTER_STREAMING_BENCHMARK=1 bun run test:application -- e2e/streaming.benchmark.spec.ts --workers=1
```

The browser SDK is same-origin and sends cookies (`credentials: "include"`). During development Vite proxies API and public auth routes to `VITE_API_ORIGIN` (default `http://localhost:3210`); no production API URL is baked in. Sign in through `/auth/login`, then choose a workspace, project, and session. URLs are reloadable as `/?workspace=<workspace-id>&session=<session-id>`.

`tsconfig.json` covers the SPA source through the package `typecheck`
command. `e2e/tsconfig.json` is a separate Node/TestApp project used by the
Playwright fixture. Application E2E requires Bun, Node 22+, Docker, and
Chromium; each test starts its own TestApp, database, Vite host, and browser
context.

## Verification

| Check                                                    | Verified result                                            |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Starter typecheck and both E2E TypeScript configurations | Pass                                                       |
| Starter build                                            | Pass                                                       |
| Default application suite                                | Pass: 26 tests; the opt-in benchmark is skipped by default |
| Production streaming benchmark                           | Pass: 1 test in 19.2 s                                     |

Run the opt-in benchmark with:

```sh
STARTER_E2E_BUILD=1 STARTER_STREAMING_BENCHMARK=1 bun run test:application -- e2e/streaming.benchmark.spec.ts --workers=1
```

The benchmark recorded p95 frame duration `16.700000000000045ms`, no long
tasks, and retained history `1`. A prior `16.8ms` small-fixture result is not a
statistically meaningful improvement comparison; benchmark samples are not
retained.
