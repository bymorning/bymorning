# ByMorning Agent Guide

Package-local `AGENTS.md` files add constraints for their own scope. When a
package compatibility, generation, or protocol rule conflicts with this guide,
the narrower package rule wins.

## Sources Of Truth

- `CONTEXT.md` is the canonical, implementation-free domain glossary.
- `references/domain-design.md` defines how to establish or change a domain.
- `references/service-design.md` defines how to design a public service.

Read `CONTEXT.md` before product behavior, architecture, API, schema, or naming
work. Tooling-only and mechanical changes do not require a domain pass.

## Local App Testing

For automated behavior tests, read the [Application harness runbook](packages/testing/src/README.md).
Use `TestApp.make`, reusable scenarios, and the real generated SDK for behavior spanning
Core services, persistence, authentication, Tools, and events. Add backend/SDK scenarios
under `packages/testing/test/` and real frontend scenarios under `packages/web/e2e/application/`.
Reuse `packages/testing/src/scenario` across both. Keep focused unit/component tests when they
add coverage for pure logic or presentation.

From `packages/testing/`, run `bun run test -- test/chat.test.ts` for the conversation harness.
From `packages/web/`, run `bun run test:application` for browser conversations and
`bun run typecheck:application` for that fixture's TypeScript configuration. The browser
suite starts its own Application and Vite; no existing `bun dev` or SST is required.
Bun, Node 22+, Docker, and Chromium are the prerequisites. Each test gets its own
migrated database, files, API/web ports, model script, and browser context; one
PostgreSQL server per `vitest` run serves every database as a template clone.

Seed through public services. Do not reconstruct the Workspace graph, replace the SDK,
or fabricate API/event responses to claim application-level coverage. Script the external
model with `TestLLM`, including the next request's actual Tool result and any background
title request. Synchronize with model gates, request receipt, domain events, and UI
readiness; do not add sleeps or retry state-changing actions. Fixture teardown verifies
model expectations and removes owned resources. Pass Vitest's test-context `signal`
to `Effect.runPromise` so timeout cancellation reaches those scoped resources.
The harness needs no ambient database,
provider secrets, or external login issuer. Real code execution additionally requires
the Docker execution profile and its built image, as described in the runbook.

For interactive development using persistent local data, follow the startup guide below.

Read [the host guide](app/host/README.md) before running
the full app. Local development uses `bun run local`; SST remains for commercial AWS deployment.
Azure installations deploy with `installers/azure` (Terraform module, Kubernetes manifests, and an
example environment; see its README).
With Bun, Node 22+, and Docker available, run from the repository root using
unused ports:

```sh
PORT=4001 APP_ORIGIN=http://localhost:4001 bun run local
```

`PORT` selects the single browser/API origin and port. The development host uses PGlite by default; build the
execution image as documented in `app/host/README.md` when you need Code Interpreter. The development host serves the built UI and API.
Open `APP_ORIGIN`; local sign-in continues straight to the workspace. Auth is
enforced through the configured local identity and normal cookies; no external
issuer is needed. Verify that the workspace finishes loading before testing.

Use another free port pair when an existing app is running; respect package-local
process restrictions. Different ports still share default data. Parallel tests
requiring isolation must also use separate databases, storage directories,
cookie-key files, and browser contexts as described in the guide. Run tests and
`bun typecheck` from the relevant package directory, never tests from the root.

## Domain First

Before adding, renaming, or moving a domain concept, capability, ownership rule,
or service seam:

1. Read `references/domain-design.md` and investigate the repository for facts.
2. Propose the canonical term and meaning. Do not decide unresolved domain
   questions autonomously.
3. Wait for user confirmation.
4. Record the confirmed, implementation-free definition in `CONTEXT.md` before
   designing the service.

Routine work within an established concept reuses the current glossary and does
not reopen domain design.

## Public Service Design

Read `references/service-design.md` before creating a public service, changing
its interface, moving its seam, or materially redistributing its authority.

Before implementation, present the proposed public interface for confirmation.
The proposal must include its authority, signatures, inputs and outputs, typed
errors, dependencies, private internals, deletion-test rationale, call and
dependency graphs, Layer composition, and test strategy. Do not include
implementation pseudocode. Wait for user approval.

## Core Domains

Every new or materially redesigned public capability in `packages/core` is an
Effect service and has one public top-level entrypoint:

```text
packages/core/src/<domain>.ts       public domain interface
packages/core/src/<domain>/**       private subservices, adapters, and dependencies
```

The namespace, file, and private folder map exactly. For example,
`ModelDefinition` maps to `model-definition.ts` and `model-definition/`.

Use the established singular namespace shape: `X.Interface`, `X.Service`, and
only the Layer and capability-specific exports callers need. Nested domain files
are unsupported private implementation even if the package's broad export
pattern can technically resolve them. Project code must not import them across
the domain seam.

## Public Names

Apply these rules project-wide to new or deliberately renamed hand-authored
symbols on supported package surfaces:

- Every public name is singular and contains at most two lexical words.
- Each PascalCase or camelCase segment and each initialism counts as one word.
  `ModelID` is two words; `APIKeyValue` is three.
- Always spell the identifier initialism `ID`, never `Id`. Do not infer a wider
  initialism-casing rule.
- Public operations have a hard two-word maximum.
- Use `create`, `get`, `list`, `update`, or `delete` when the behavior has exactly
  that CRUD meaning. Otherwise use the shortest literal contextual verb, such
  as `register`, `enable`, `open`, or `resolve`.
- Let the owning service provide noun context: use `Workspace.list()`, not
  `listWorkspaces()`.
- Do not use generic public suffixes such as `Manager`, `Processor`, `Helper`,
  `Repository`, or `Service`. The required nested Effect tag `X.Service` is the
  exception.
- Do not impose an arbitrary maximum operation count. Keep the service cohesive
  and its caller burden low.
- Every hand-authored tagged error class and its `_tag` string ends in `Error`,
  such as `Session.NotFoundError`. The canonical name `Error` itself also
  satisfies this rule.

These rules are prospective. Do not rename existing symbols solely to conform.
Preserve generated output, compatibility contracts, and names governed by a
package-local guide unless a separate change explicitly authorizes migration.
