# Plugin-owned policy implementation plan

Approved for implementation by the user on 2026-09-09. Design: [plugin-policy.md](plugin-policy.md).

## Execution

All implementation work is delegated to subagents. The coordinating agent owns integration, review, and verification tracking. Backend work uses Effect and the attached Effect source reference. Existing staged and unstaged user work must be preserved; agents edit only their assigned files and do not commit, reset, or stage files.

| Workstream | Ownership | Dependencies | Completion gate |
| --- | --- | --- | --- |
| A — Contracts and lifecycle | Schema inference inputs; Plugin Promise/Effect API and adapters; Core Plugin hook executor | Approved design | Scoped admission, once-only observers, cleanup, typed failures, focused tests |
| B — Runtime and built-ins | Plugin hosts/registry/supervisor; shared Workspace activation; built-in Budget/Limiter/routing; server composition | A contracts | Cold Gateway activation, shared stores, required readiness, reload draining |
| C — Inference integration | Session usage wrapper; native/translated Gateway invocation and exchanges | A contracts, B composition | No direct duplicate limit orchestration; correct error/usage/cancellation behavior |
| D — Policy migration | Legacy definitions export/conversion; Core evaluator retirement; protocol/server/client migration | A/B hooks | Preserved stored definitions, direct Plugin behavior, obsolete authority removed |
| E — Frontend and docs | Policy editor replacement with Plugin configuration; navigation; product/developer docs | D migration contract | Solid correctness, relevant tests, truthful docs |
| F — Application verification | Reusable real Application scenarios and integration tests | A–E | Real SDK/HTTP execution across admission, usage, streaming, lifecycle |

Independent workstreams begin in parallel. Shared-file changes are handed to the owning agent rather than edited concurrently. Generated output is regenerated only after source surfaces settle.

## Verification gates

1. Focused lifecycle tests: admission refusal, late failures, observer order, once-only usage, cleanup and cancellation.
2. Runtime tests: Workspace/member hook composition, cold activation, required failure, reload drains without resetting state.
3. Real Application scenarios: Session plus Gateway budget/rate enforcement, native and translated streaming, background inference, MCP hooks and Permission preservation.
4. Package-local typechecks and affected tests; protocol/client generation checks; frontend checks.
5. Independent Effect backend and Solid frontend reviews; fix findings and rerun affected checks.
6. Final diff/whitespace inspection and explicit results, including any environmental blockers or unresolved migration cases.

## Progress

- Planning: complete.
- Implementation: in progress.
- Integration and verification: pending.

## Verification log

| Check | Result |
| --- | --- |
| Prerequisites | Bun 1.3.14, Node v25.9.0, Docker 29.4.2 available |
| Existing Budget/Limiter authority tests (`packages/core`: `bun run test -- test/budget.test.ts test/limiter.test.ts`) | Passed: 2 files, 12 tests |

Baseline index and worktree diffs are retained in `/tmp/opencode/plugin-policy-initial-{index,worktree}.patch` to distinguish existing user work during final review.

## Migration invariant

Retain and export user-authored managed definitions before retiring their reader. Report each conversion and any unsupported case explicitly. Do not silently discard retained rules or represent previously unwired rule kinds as proven enforcement.
