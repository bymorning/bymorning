# Client Solid Entry Guide

`@bymorning/client/solid` owns the caller-local reactive Client View defined in
`CONTEXT.md`. Its only supported runtime import is `@bymorning/client/solid`; do not
add public subpath exports or export private implementation modules.

The approved public contract governs this entrypoint.
It owns a shared Data store and explicit Connection factory: applications own
connection construction, synchronization, recovery, selection, and retention.
Keep the explicit root exports, factory signatures, invalidation, eviction,
reconciliation, and original SDK error semantics intact. Internal modules may
change without becoming consumer APIs.

The package does not bootstrap reads, recover selection after reconnect, retain
selected history, or render a timeline. Applications perform those explicit
actions; `invalidate` never fetches, and failed/uncertain Submissions remain
until acknowledged or dismissed.

Use Solid owners and `createStore` for structured reactive state. Do not depend
on the existing frontend, Core, Server, Testing, a router, or a query framework.
Run `bun run typecheck:solid` and `bun run test:solid` from `packages/client`. Focused
tests use jsdom and controlled generated-SDK HTTP responses; starter E2E
coverage is owned by `packages/starter/e2e` and uses a separate TypeScript
configuration and real TestApp fixture.
