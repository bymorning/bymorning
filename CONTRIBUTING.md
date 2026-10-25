# Contributing to ByMorning

Thanks for helping. This guide covers how to run the project, what a good change
looks like, and how review works.

## Before you start

- Read [`README.md`](README.md) to run the app, and [`CONTEXT.md`](CONTEXT.md) for the
  domain vocabulary. Use those terms in code, tests, and UI text.
- [`AGENTS.md`](AGENTS.md) holds the architecture and naming rules. It is written for
  coding agents but applies to everyone.
- For a bug or a small improvement, open a pull request. For a new feature, a new
  domain concept, or a change to a public service interface, open an issue first so
  we can agree on the design. `references/domain-design.md` and
  `references/service-design.md` describe what that discussion covers.

## Set up

You need Bun 1.3, Node 22+, and Docker (Docker is only needed for the application
tests and Code Interpreter).

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000. Local development needs no cloud credentials, SST, or
external login provider.

## Tests and checks

Run tests from the package you changed, never from the repository root:

```sh
cd packages/core && bun run test
cd packages/web && bun run test
```

Behavior that spans services, persistence, authentication, and the web UI belongs in
the application harness; start with
[`packages/testing/src/README.md`](packages/testing/src/README.md). Script the external model with
`TestLLM`; do not fake API responses or add sleeps.

### What makes a test worth keeping

A test is a cost (maintenance, CI time, noise when it breaks for no reason) that pays
off only by the risk it removes. A test belongs here only if it:

1. **Protects something real**: user-visible behavior, an API or wire contract,
   authorization and security, data integrity, or a regression for a real bug. Ask who
   notices if it breaks in production.
2. **Survives a refactor**: renaming a file, restructuring the implementation, adding
   an item to a list, or swapping a font must not break it while behavior is unchanged.
3. **Is not already enforced** by the typechecker, lint, a generator `--check`, or a
   stronger test.
4. **Asserts outcomes, not implementation**: no grepping source text, no counts of
   files or assets, no constants copied from the source, no checks that a deleted thing
   stays deleted, and no mocks asserting only that the mock was called.
5. **Costs less than it protects**: not flaky, not slow for what it guards.

When a test fails only because you changed something harmless, delete it rather than
update it. Tests that carry a compliance ID such as `[SEC-...]` are kept.

Before you push:

```sh
bun run format        # prettier
bun run lint
bun run typecheck
```

`bun run check` runs the full gate that CI runs.

## Pull requests

- Keep a pull request to one change. Say what it changes and why.
- Add or update tests with the change, and update `CHANGELOG.md` under `[Unreleased]`
  when behavior a user or operator sees changes.
- Generated files (`packages/protocol/openapi.json`, `packages/client/**/generated`,
  the model catalog, theme CSS) are regenerated with their package's `generate` script;
  do not edit them by hand.
- Database migrations are forward-only. Never edit a migration that has shipped; add a
  new one.
- Never commit secrets, customer data, or machine-specific paths. CI runs gitleaks.

## Licensing

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), the same license as the project.

## Conduct and security

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report
vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md), not in public
issues.
