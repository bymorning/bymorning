# Starter package instructions

An independent Solid SPA. Production source consumes conversation state only from
`@bymorning/client/solid` and presentation from `@bymorning/ui` and
`@bymorning/session-ui`. Never import Core, Server, Testing, or existing
frontend sources in `src/`. Use `createStore` for structured local state. Do not
restart an existing app or server process.

## Where things go

| Path                        | Owns                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `src/entry.tsx`             | Mount point; imports token/style CSS and `App`                                           |
| `src/app.tsx`               | Application providers: theme, i18n, workspace                                            |
| `src/runtime/auth.ts`       | Browser client, workspace discovery, login URL                                           |
| `src/runtime/workspace.tsx` | Workspace discovery state, URL selection, retry                                          |
| `src/runtime/server/`       | Server scope: Connection then Data in one owner, bootstrap, recovery, sync, Query client |
| `src/shell/shell.tsx`       | Persistent host: titlebar, desktop rail + resize, content slot, Toast region             |
| `src/shell/titlebar/`       | Persistent header; reads workspace and layout providers                                  |
| `src/shell/routes/`         | Route composition beneath the shell (boot/login/error/ready branches)                    |
| `src/shell/state/`          | Ephemeral layout state: rail width, drawer open, navigation mounts                       |
| `src/shell/mobile-drawer.*` | Drawer primitive (Corvu wrapper and its CSS)                                             |
| `src/shell/mobile-panel.*`  | Drawer panel anatomy: header, label, close, content slot                                 |
| `src/home/`                 | Workspace-scoped route: session navigation and selection                                 |
| `src/session/`              | Conversation composition over `@bymorning/session-ui`                                    |
| `src/workspaces/`           | File browser model                                                                       |
| `src/style.css`             | Shell, navigation, connection, and file browser styles only                              |
| `e2e/`                      | Playwright application tests; TestApp imports allowed only here (own tsconfig)           |

## Patterns

Worked examples for every pattern — where files go and the code shape — are in
[`examples.md`](examples.md). The core rules:

- Shell chrome (`Shell`, `Titlebar`) reads providers; never thread application
  controls through runtime or route props. `Shell` accepts children only.
- Route content renders as children under the shell. A feature portals its
  navigation into the shell's mounts so it keeps its own Solid owner and
  workspace-scoped Data; only the matching runtime subtree resets on navigation.
- A new screen is a new branch in `src/shell/routes/` plus a feature folder beside
  `home/`. Reach for `@bymorning/ui` primitives before writing new chrome.
- Runtime scopes are keyed by origin, identity generation, and workspace. The
  runtime owns explicit bootstrap, selected-session recovery, and eviction of only
  the prior selected session; components read Data and call its operations.
- Timeline precedence stays in the app: Message, then Inbox, then local Submission.
  Multiple views share one application selection; no observer leases.
- Query is restricted to workspace discovery and directory content. Keys start
  with origin, identity generation, and workspace; retries and automatic refetches
  stay disabled; Data invalidation never fetches; file controls gate on
  `ServerSync.queryReady()`, not raw connection state. File writes use native
  TanStack mutation state scoped to the file.
- Scope disposal order: close recovery, await Query cancellation, clear the cache,
  then dispose Data/Connection.
- Layout state (rail width, drawer open) is ephemeral and never persisted.

## Checks

Run from this package:

```sh
bun run typecheck
bun run build
bun run test:application
```

The streaming benchmark is opt-in:
`STARTER_E2E_BUILD=1 STARTER_STREAMING_BENCHMARK=1 bun run test:application -- e2e/streaming.benchmark.spec.ts --workers=1`.
Its default skip is intentional, not a failed check.
