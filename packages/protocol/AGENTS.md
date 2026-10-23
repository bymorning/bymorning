# Protocol Package Agent Guide

## Source of truth

`@bymorning/protocol` is the authoritative public HTTP contract. Hand-author API groups, endpoints, transport schemas, success schemas, and error schemas in this package.

The client packages are derived from `packages/protocol/src/api.ts`:

```text
packages/protocol/src/api.ts
  -> packages/client/script/build.ts
     -> packages/client/src/promise/generated/*
     -> packages/client/src/effect/generated/*
     -> packages/client/src/effect/api/api.ts
```

Do not hand-author duplicate request or response types in the client. Put transport contract changes in Protocol and regenerate the clients.

## Authorship boundary

These files are hand-authored:

- `packages/protocol/src/**`
- `packages/httpapi-codegen/src/**`
- `packages/client/script/build.ts`
- `packages/client/src/contract.ts`
- `packages/client/src/promise/index.ts`
- `packages/client/src/promise/api.ts`
- `packages/client/src/effect/index.ts`
- `packages/client/src/effect/api.ts`

These files are generator-owned and must not be edited manually:

- `packages/client/src/promise/generated/**`
- `packages/client/src/effect/generated/**`
- `packages/client/src/effect/api/api.ts`
- every `.httpapi-codegen.json` manifest

## Required workflow

After changing any public HTTP endpoint or its transport schemas, regenerate the clients from the repository root:

```sh
bun run --filter @bymorning/client generate
```

Then run the focused checks:

```sh
bun run --filter @bymorning/protocol typecheck
bun run --filter @bymorning/client typecheck
bun run --filter @bymorning/client check:generated
```

Commit protocol changes and regenerated client output together. Generation is currently an explicit developer step; never assume another build command regenerated the clients.

## Change discipline

- Treat Protocol as a boundary Adapter: it describes HTTP transport, not application orchestration or persistence.
- Reuse schemas from `@bymorning/schema` when they represent the same public meaning. Define protocol-specific projections when the HTTP shape differs.
- Preserve endpoint identifiers deliberately because they determine generated client method paths.
- Review generated Promise and Effect surfaces after generation; a successful generator run does not prove that a renamed endpoint produced an ergonomic or compatible API.
- Change `packages/httpapi-codegen` only for behavior that should apply generically to generated clients. Keep ByMorning-specific mapping and wiring in `packages/client/script/build.ts`.
- Never edit generated output to work around a protocol or generator defect. Fix the owning hand-authored source and regenerate.
- Preserve unrelated worktree changes.
