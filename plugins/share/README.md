# Share plugin

`@bymorning/plugin-share` owns the `share` and `unshare` Tools and the public path contract. The host still serves anonymous reads (`Share.get` and `GET /api/public/share/:workspaceID/:token`) because a Plugin cannot register HTTP. The public page lives in `packages/web` so it can reuse the Session workspace UI (`SessionHeader` and `SessionTimeline`).

```jsonc
{ "plugins": ["@bymorning/plugin-share"] }
```

Plugin id is `bymorning.share`. Core `Share.get` reads that same storage namespace. Do not rename the id without migrating grants.

## Server and web exports

```text
plugins/share/
  src/index.ts       "./" and "./server" — Tools and grant writes
  src/web/path.ts    "./web" — ShareRoutePath and shareRouteHref
packages/web/src/share/
  route.tsx          mounts the Session workspace for a Share.View
```

The host loads `./server` as unsandboxed in-process Plugin code. `packages/web` imports `./web` for the path and renders the Session UI itself. The Plugin does not register routes at runtime.

```tsx title="packages/web/src/shell/routes/routes.tsx"
import { ShareRoutePath } from "@bymorning/plugin-share/web"

<Route path={ShareRoutePath} component={Share} />
```

Mount public pages outside `WorkspaceProvider` so anonymous visitors are not sent to login.

## Tools

`share` and `unshare` take no input. The Session is the caller.

- `share` rotates any existing grant, writes `session:{sessionID}` and `token:{token}`, and returns `{ url: "/s/{workspaceID}/{token}", token }`.
- `unshare` deletes those keys and returns `{ unshared: true }`, or `{ unshared: false }` when nothing was shared.

Both require permission action `share` on `session:{sessionID}` and a member-scoped `session.get`. They are not Code Mode Tools (`codemode: false`).

## Public page

`packages/web` fetches `client["server.share"].get` and projects saved Messages onto the same `SessionTimeline` used by a member Session. There is no composer, no Bus, and no right sidebar. Invalid tokens never leave the browser. Missing, rotated, and revoked grants render the same not-found copy.
