# Worked examples

Every pattern an agent needs to place new code correctly. Each example states
where files go, why, and the minimum code shape. Read [`AGENTS.md`](AGENTS.md)
for the directory map; this file shows the patterns in action.

```text
Where does it go?
1. Always-visible chrome ........................ Example 1
2. Responsive panel / shell state .............. Example 2
3. Whole new screen ............................. Example 3
4. Feature state + view in a workspace route ... Example 4  (start here for most features)
5. Data-backed action ........................... Example 5
6. Connection/recovery-sensitive UI ............. Example 6
7. Server surface via Query ..................... Example 7
8. Session presentation adapter ................. Example 8
9. Runtime contract change ..................... Example 9
10. Application test ............................ Example 10
```

---

## Example 1 — Chrome control in the titlebar

**Feature:** a "Copy workspace ID" button in the header.
**Why here:** always visible, no route or Data knowledge — pure chrome. Chrome
reads providers; it never receives application controls as props.

`src/shell/titlebar/titlebar.tsx` — add beside the workspace select:

```tsx
const workspace = useWorkspace()
// ...
<Show when={workspace.state.workspace}>
  <button class="shell-copy" onClick={() => void navigator.clipboard.writeText(workspace.state.workspace!)}>
    Copy ID
  </button>
</Show>
```

Rules demonstrated:

- No new file: the titlebar is the single owner of header chrome. A _new_ chrome
  region (e.g. a footer bar) would be `src/shell/footer/footer.tsx` + CSS in
  `src/style.css`, rendered from `src/shell/shell.tsx`.
- Reads `useWorkspace()`/`useLayout()` — never a prop threaded from `App`.
- If the control belongs in `@bymorning/ui` (reusable across apps), add it
  there instead; Starter only composes.

---

## Example 2 — Ephemeral shell panel (responsive, desktop + mobile)

**Feature:** an openable "status" panel: a side region on desktop, a mobile
drawer panel on small screens.
**Why here:** layout state (open/width/mounts) is ephemeral shell state, and the
mobile drawer panel anatomy already exists.

1. Extend the store in `src/shell/state/layout.tsx`:

```ts
const [state, setState] = createStore({
  // ...
  statusOpen: false,
  statusMount: undefined as HTMLElement | undefined,
  desktopStatusMount: undefined as HTMLElement | undefined,
})
return {
  // ...
  openStatus: (open: boolean) => setState("statusOpen", open),
  mountStatus: (element: HTMLElement | undefined) => setState("statusMount", element),
  mountDesktopStatus: (element: HTMLElement | undefined) => setState("desktopStatusMount", element),
  status: () => (state.mobile ? state.statusMount : state.desktopStatusMount),
}
```

The desktop region is rendered from `src/shell/shell.tsx` next to the rail's
navigation mount, using `mountDesktopStatus` the same way the rail uses
`layout.mount("desktopMount", …)`.

2. Render the desktop region and the mobile panel from the titlebar, mirroring
   the sessions drawer:

```tsx
<MobileDrawer open={layout.state.statusOpen} onOpenChange={layout.openStatus} closeOnOutsideFocus={false}>
  <MobileDrawerTrigger class="shell-menu" aria-label="Open status">
    Status
  </MobileDrawerTrigger>
  <MobileDrawerContent>
    <MobilePanel title="Status">
      <div ref={(element) => layout.mountStatus(element)} />
    </MobilePanel>
  </MobileDrawerContent>
</MobileDrawer>
```

3. The feature itself (data-owning component) portals in from wherever its
   runtime owner lives — see Example 4.

Rules demonstrated:

- Never persist `state.statusOpen` or widths; layout state is ephemeral.
- Reuse `MobileDrawer`/`MobilePanel` rather than composing Corvu directly.
- One drawer trigger per panel; a trigger must be inside its `MobileDrawer`
  root. Programmatic-only drawers (no trigger) can wrap root + content in one
  component like `MobilePanel` and take `open`/`onOpenChange` props.

---

## Example 3 — New screen

**Feature:** a "Workspace settings" screen reachable at `?screen=settings`.
**Why here:** a whole route is a new branch under the shell; its logic gets a
feature folder beside `home/`, never inside `shell/`.

1. Create `src/settings/route.tsx` + `src/settings/model.ts` (same model/view
   split as `src/home/`).
2. Add the branch in `src/shell/routes/routes.tsx`:

```tsx
const screen = () => new URLSearchParams(location.search).get("screen") === "settings"
// inside the Shell children, after the ready Match:
<Show when={workspace.state.boot === "ready" && workspace.state.workspace && screen()}>
  <SettingsRoute />
</Show>
```

Rules demonstrated:

- Screens render as children of `Shell`; they do not wrap it.
- URL is the navigation surface (like `?workspace=&session=`); use
  `history.pushState`/`popstate` like `src/home/sessions/model.ts` does.
- A screen that needs Data only works _below_ `ClientScope`; `Shell`, routes
  branches, and chrome stay Data-free.

---

## Example 4 — Feature state + view in a workspace route (the common case)

**Feature:** filter the session list by title. Most features are this shape:
state and actions in the feature's model, presentation in its view, both inside
the feature folder of the route that owns the screen.

**Step 1 — classify.** Workspace-scoped, Data-backed, pure local state. No
chrome, no route, no runtime change → `src/home/sessions/`.

**Step 2 — model: `src/home/sessions/model.ts`.** Structured local state uses
`createStore`; derived values use `createMemo`; filtering is local, never a
server search:

```ts
const [state, setState] = createStore({
  // ...existing fields
  filter: "",
})
const sessions = createMemo(() => {
  const filter = state.filter.trim().toLowerCase()
  const all = server.data.session.list()
  return filter ? all.filter((s) => (s.title ?? "").toLowerCase().includes(filter)) : all
})
return { /* ...existing */, sessions }
```

**Step 3 — view: `src/home/sessions/view.tsx`.** Presentation only:

```tsx
<input
  aria-label="Filter sessions"
  placeholder="Filter"
  value={model.state.filter}
  onInput={(e) => model.setState("filter", e.currentTarget.value)}
/>
<nav>
  <For each={model.sessions()}>{(session) => /* existing button */}</For>
</nav>
```

**Step 4 — tests:** `e2e/sessions.spec.ts` (Example 10).

Rules demonstrated:

- `SessionNavigation` is portaled into the desktop rail and the mobile drawer;
  the model is shared, so both mounts get the filter with no extra work.
- The model never fetches; Data reads stay reactive accessors.
- Styles for this feature's markup go in `src/style.css` (it holds shell,
  navigation, connection, and file-browser styles).

---

## Example 5 — Data-backed action with mutation state

**Feature:** any write/action (create, switch, retry). Never build a second
cache; use TanStack mutation state in the feature model.

`src/home/sessions/model.ts` — existing shape to copy:

```ts
const createSession = useMutation(() => ({
  mutationFn: (projectID: ProjectID) => server.data.session.create({ workspace: server.workspace, projectID }),
  onSuccess: (session) => select(session.id),
}))
```

The view renders `isPending` on the button and surfaces
`errorText(model.createSession.error)` in a `role="alert"` paragraph. For
actions keyed to a row or file, scope the mutation state to the affected item
(see the per-path `mutationKey` in `src/workspaces/files/model.tsx`).

Rules demonstrated:

- The model calls generated-shaped Data operations; it does not reconstruct
  request/response shapes.
- Success effects that change navigation write the URL through the model
  (`select`), not from the view.
- Expected failures render through the model's error state; they are not thrown
  into unhandled rejections.

---

## Example 6 — Connection/recovery-sensitive UI

**Feature:** anything that must not act while transport or bootstrap is
in-flight.

Two distinct sources, never mixed:

```tsx
// Transport + retry, owned by Connection (see HomeRoute's Connection component):
const server = useServer()
<Show when={server.connection.state().state !== "connected"}>…Retry…</Show>

// File/Query readiness, owned by ServerSync — the only file-surface gate:
<Show when={server.queryReady()}>…directory UI…</Show>
```

Rules demonstrated:

- `server.state.boot` / `server.state.error` for bootstrap; `server.connection`
  for streams; `server.queryReady()` for Query-gated surfaces. Do not derive
  one from another.
- Reconnect recovery is exclusively `ServerSync`'s; components never refetch on
  reconnect. Invalidation happens without fetching in `src/runtime/server/`.

---

## Example 7 — Server surface via Query

**Feature:** a new read-only server surface that Data does not own (like
directory content). Query is restricted to this shape.

Follow `src/workspaces/files/model.tsx`:

```ts
export const directoryQuery = (scope: ServerScope, projectID: ProjectID) =>
  queryOptions({
    queryKey: [scope.origin, scope.identity, scope.workspace, "project-directory", projectID] as const,
    queryFn: ({ signal }) => scope.api.project.directory.list({ workspace: scope.workspace, projectID }, { signal }),
  })
```

Rules demonstrated:

- Key starts with `origin, identity, workspace` — always. No credentials in keys.
- `retry: false` and no automatic refetch; the shared `QueryClient` in
  `src/runtime/server/runtime.tsx` already enforces defaults — do not override
  them per query.
- Gate `enabled` on the identity-aware activation pattern and `queryReady()`,
  and reset local state (selections, drafts) in a `createEffect` keyed by the
  full scope string so nothing crosses a workspace/project boundary.
- If Data can own the surface instead, prefer Data (Example 5).

---

## Example 8 — Session presentation adapter

**Feature:** a new control inside the conversation (like agent/model switching).
Presentation comes from `@bymorning/session-ui`; Starter owns values, choices,
and mutation state.

`src/session/session.tsx` — the adapter shape:

```tsx
const switchAgent = useMutation(() => ({
  mutationFn: (input: { readonly sessionID: SessionID; readonly agent: /* … */ }) =>
    server.data.session.switchAgent(input),
}))
const agent: SessionUI.Select = {
  value: () => server.data.session.get(props.sessionID())?.agent,
  choices: server.data.agent.list().map((item) => ({ key: item.id, label: item.name })),
  action: {
    pending: () => switchAgent.isPending,
    error: () => (switchAgent.error ? describe(switchAgent.error) : undefined),
    run: (value) => {
      const selected = server.data.agent.list().find((item) => item.id === value)
      if (selected && !switching()) switchAgent.mutate({ sessionID: props.sessionID(), agent: selected.id })
    },
  },
}
```

Rules demonstrated:

- Package renders explicit inputs; it never reads Data or holds selection.
- Timeline row precedence stays in the app: Message, then Inbox, then local
  Submission.
- Do not add package-owned uploads/commands/rename/resource navigation without
  an explicit adapter following this pattern.

---

## Example 9 — Runtime contract change

**Feature:** new lifecycle behavior (e.g. a new recovery target or bootstrap
phase). This is the rarest change; extend `ServerSync`, not a component.

`src/runtime/server/sync.tsx` owns bootstrap, selected-session recovery, and
eviction. When extending:

- Keep `ServerSync` the single owner; components only observe `state`,
  `connection`, `queryReady`, and call `bootstrap`/`select`.
- Preserve the disposal order enforced in `ServerRoot` (`runtime.tsx`):
  `server.close()` → `query.cancelQueries()` → `query.clear()` →
  `server.dispose()`. Any new resource joins this order.
- Keep recovery targets explicit (active observers only); eviction remains
  limited to the prior selected session.

---

## Example 10 — Application test

**Feature:** verifying any of the above end to end. Tests live in `e2e/`, import
`{ expect, test }` from `./fixture.js`, and drive the real Application.

```ts
import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("filters the session list locally", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole("textbox", { name: "Filter sessions" }).fill(app.data.session.title)
  await expect(page.getByRole("navigation").getByRole("button", { name: "New session" })).toHaveCount(0)
  await expect(page.getByRole("navigation").getByRole("button", { name: app.data.session.title })).toHaveCount(1)
})
```

Rules demonstrated:

- TestApp/Testing imports are allowed only under `e2e/` (own tsconfig).
- Script the external model with `Chat.script`/`app.llm` and synchronize on UI
  readiness — no sleeps, no fabricated API responses.
- Prefer user-facing selectors (`getByRole`, accessible names) over CSS classes;
  `data-slot` selectors are acceptable for chromeless anatomy (drawer overlay,
  resize handle).

---

## Anti-patterns

| Don't                                                     | Do                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Thread a control from `App` through providers into chrome | Chrome reads `useWorkspace`/`useLayout`                          |
| Wrap `Shell` in a route or feature                        | Routes render as `Shell` children via `src/shell/routes/`        |
| Fetch inside a feature model                              | Read Data reactively or use the gated Query pattern (Example 7)  |
| Persist rail width, drawer open, filters, or tabs         | Keep them ephemeral (`createStore`)                              |
| Refetch on reconnect in a component                       | Let `ServerSync` recover; components only invalidate-free read   |
| Duplicate write state in an app cache                     | TanStack mutation state scoped to the target (Example 5)         |
| Build chrome markup per feature                           | Compose `@bymorning/ui`; reach for Corvu only via `MobileDrawer` |
| Import Core/Server/Testing in `src/`                      | Only `@bymorning/client(/solid)`, `ui`, `session-ui`             |
| Put tests beside source                                   | `e2e/` with the shared fixture                                   |
| Rename or move runtime seams casually                     | Runtime changes follow Example 9's ownership rules               |
