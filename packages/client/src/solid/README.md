# @bymorning/client/solid

Solid-owned reactive Client Views for the generated `@bymorning/client` SDK.

The only supported import is `@bymorning/client/solid`. Create a Connection and Data
under a Solid owner. The application explicitly synchronizes, recovers, and
evicts selected-session data. The complete contract is
the approved Solid Client contract documentation.

```ts
import { createConnection, createData } from "@bymorning/client/solid"

const connection = createConnection({ api: api.event, workspace })
const data = createData({ api: () => api, workspace, event: connection, connection })
```

Both factories must run under Solid owners. Connection owns one workspace Event
stream; Data owns the caller-local shared cache and event projection.

`Data` never selects a Session or starts a read implicitly. The application
calls explicit `sync`/`load`, calls `evict` for history it no longer retains,
and handles reconnect recovery. `invalidate` only marks a completed or active
read stale; it never fetches. Local prompt and compaction Submissions remain
visible until an HTTP response, Event echo, or positive Inbox read acknowledges
them. Explicit calls reject with their original generated SDK error (or abort)
so SDK error predicates remain usable.

The Starter's `src/runtime/server/sync.tsx` is the reference application orchestration: it
owns bootstrap, selected-session synchronization, reconnect recovery,
selected-only retention, and the private timeline precedence of Message, Inbox,
then local Submission.

Run focused checks from this directory:

```sh
bun run typecheck:solid
bun run test:solid
```
