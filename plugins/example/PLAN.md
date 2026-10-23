# Enterprise example implementation plan

Build ten independently loadable Promise plugins using the existing public Plugin API.
Keep each source file copyable without sibling helpers. Give every Plugin, Skill,
Integration, and Policy a distinct example identity.

## Parallel implementation

Each track runs in a separate minion subagent. Tracks own disjoint files and can
proceed together after the package scaffold exists.

| Track                   | Owned source files                                                | Outcome                                                                       |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Knowledge and workflows | `company-context.ts`, `incident-response.ts`, `release-review.ts` | Shared instructions and references, plus two on-demand operational Skills.    |
| Internal systems        | `service-catalog.ts`, `service-lookup.ts`                         | Configurable MCP discovery and an authenticated, read-only REST Tool.         |
| Company policies        | `company-policy.ts`, `model-routing.ts`                           | Tool restriction, text redaction, and configurable Model routing.             |
| Operations              | `tool-activity.ts`, `request-tags.ts`, `retry-control.ts`         | Structured activity logs, correlation headers, and bounded automatic retries. |

Each minion reads `CONTEXT.md`, the Plugin guide, public types, and the relevant
runtime implementation. It implements only its owned examples and any focused
tests needed for nontrivial behavior, then reports configuration and limitations.

## Integration

The coordinating agent owns `package.json`, `tsconfig.json`, this plan, and
`README.md`. After the parallel tracks finish:

1. Review the combined examples against the public contract and runtime behavior.
2. Document each example's purpose, options, prerequisites, and loading procedure.
3. Run `bun typecheck` and `bun run test` from `plugins/example/`.
4. Check formatting and run `git diff --check`.

Use focused tests for meaningful boundaries such as authentication and retry
decisions. Do not describe registration fixtures as application-level coverage.
External example endpoints require company-specific configuration before live use.

## Completion

All four minion tracks are implemented and reviewed. The package contains ten
standalone Plugins, setup documentation, and focused tests for REST lookup and
retry decisions. Package typechecking and all 15 tests pass. The real Plugin
host resolves and imports all ten distinct entrypoints.
