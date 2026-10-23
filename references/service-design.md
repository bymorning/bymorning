# Service Design

Treat a service as an authority seam: a cohesive capability with a small public
interface that hides meaningful behavior, policy, sequencing, or translation.
Use `Service` as ByMorning's architectural term as well as the nested Effect tag
name.

## Deep Services

A deep service gives callers leverage and keeps change local:

```text
┌──────────────────────┐
│ Small public interface│  few operations, simple inputs, explicit outcomes
├──────────────────────┤
│                      │
│ Deep implementation  │  policy, sequencing, invariants, adapters, lifecycle
│                      │
└──────────────────────┘
```

A shallow service merely mirrors another interface or exposes its implementation
steps. Apply the deletion test: if deleting the service spreads its complexity
across callers, it earns its seam; if complexity disappears, keep the behavior
as a value or inside its existing owner.

The interface is everything a caller must know: operation types, invariants,
ordering, expected errors, requirements, configuration, and material performance
or lifecycle behavior. Callers and tests should cross the same interface.

Before adding a seam, inspect existing services and adapters. Reuse or deepen an
existing authority when it changes for the same reason. Add a distinct service
when it owns distinct authority, dependencies, policy, or lifecycle. A private
adapter belongs behind its owning service rather than becoming public merely for
tests.

## Core Shape

Each public Core domain has one top-level service entrypoint. Its matching folder
contains private implementation dependencies:

```text
packages/core/src/
  provider.ts               public Provider interface
  provider/                 private Provider implementation dependencies
    registry.ts
```

Do not import `provider/**` from another domain. The top-level service is the
supported seam even when a package wildcard can resolve a nested file.

## Workspace Example

[`packages/core/src/workspace.ts`](../packages/core/src/workspace.ts) demonstrates
the required namespace and Effect service shape:

```ts
export * as Workspace from "./workspace.js"

/** Account-scoped Workspace discovery authority. */
export interface Interface {
  readonly list: (account: AccountActor) => Effect.Effect<ReadonlyArray<WorkspaceAccess.Info>, ReadError>
}

/** Workspace membership information could not be read from persistence. */
export class ReadError extends Schema.TaggedError<ReadError>()("Workspace.ReadError", {
  cause: Schema.Defect(),
}) {}

/** Account-scoped Workspace discovery authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Workspace") {}
```

The name relies on its owner for context: `Workspace.list`, not
`listWorkspaces`. It does not repeat `Workspace` in the operation.

The same entrypoint owns Layer composition:

```ts
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    // Named operations are defined here.
    return Service.of({ list })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
```

Use this as a structural example, not authorization to copy Workspace's domain
rules or dependencies into another service.

## Interface Design

For each proposed operation, ask:

- Does the operation belong to this authority and change for the same reason?
- Can the owner supply noun context so the operation name stays literal and
  short?
- Can inputs be simpler or more domain-shaped?
- Are expected failures precise and typed?
- Can policy, ordering, resource lifetime, or translation move behind the seam?
- Does the operation expose a private implementation step?
- Can callers test the behavior through this interface without reaching inside?

There is no fixed operation limit. Split a service only when operations represent
different authority, require unrelated dependencies, or change for unrelated
reasons.

## Naming Examples

| Avoid                        | Prefer               | Reason                                        |
| ---------------------------- | -------------------- | --------------------------------------------- |
| `WorkspacesService`          | `Workspace`          | Singular domain name; no generic suffix       |
| `listWorkspaces()`           | `Workspace.list()`   | Owner supplies noun context                   |
| `performWorkspaceCreation()` | `Workspace.create()` | Exact CRUD behavior uses the CRUD verb        |
| `executeProviderRequest()`   | `LLMGateway.invoke()` | Owner supplies Provider invocation context    |
| `providerId`                 | `providerID`         | Identifier initialism is always `ID`          |
| `BufferedResponseError`      | `BufferError`        | Public symbols have at most two lexical words |

Use CRUD verbs only when their semantics are exact. Registration, activation,
selection, execution, and success recording are domain actions, not aliases for
CRUD.

## Approval Artifact

Before implementing a new or materially changed public service interface,
present all of the following and wait for user approval:

1. Canonical service name and authority.
2. Deletion-test result and alternatives considered.
3. Complete public TypeScript signatures.
4. Inputs, outputs, invariants, and typed expected errors.
5. Public dependencies and private subservices/adapters.
6. Caller call graph and dependency graph.
7. Layer construction and composition graph.
8. Test strategy through the public interface and real adapters where behavior
   depends on persistence or protocol mechanics.
9. Recommended design and material trade-offs.

Do not include implementation pseudocode. After approval, implement the service.
