# `@bymorning/session-ui`

Solid presentation components for a caller-owned Session view. The package has
no SDK client, query, router, Core, or application-runtime dependency at
runtime; its `@bymorning/client` imports are types only. Consumers provide
already ordered and deduplicated rows plus explicit actions.

```ts
import { SessionComposer, SessionHeader, SessionProvider, SessionTimeline, type SessionUI } from "@bymorning/session-ui"
import "@bymorning/session-ui/tokens.css"
import "@bymorning/session-ui/styles.css"
```

`SessionProvider` scopes labels and tool renderers to its subtree. A nested
provider's `tools` map replaces, rather than merges with, the inherited map.
`SessionTimeline` renders supplied ordered rows directly by default; set
`virtual` only when the caller wants its built-in virtualized list.

## Public surface

The ESM entrypoint exports `SessionProvider`, `SessionTimeline`,
`SessionComposer`, `SessionHeader`, `PermissionView`, `FormView`, the
`Markdown` namespace, and the `SessionUI` types. Styles are explicit exports:
`@bymorning/session-ui/tokens.css` establishes only scoped component tokens and
`@bymorning/session-ui/styles.css` establishes scoped component styles.

`SessionUI.Row` is supplied in application presentation order: Message, Inbox,
then local Submission. The package neither reconciles nor caches those values.
`Action` and `Operation` expose `run(): void`; the host owns mutation lifetime,
rejection handling, and subsequent observed state. An unknown Session status is
preserved rather than inferred by the presentation layer.

The composer is controlled. Commands, mentions, and attachments are optional
host callbacks; attachments do not provide upload behavior themselves. The
package similarly renders explicit Permission and Form actions without owning
their request or answer state. `SessionProvider` supplies the complete scoped
copy catalog, including metadata and `loadEarlier`. Form and Permission controls
surface their supplied errors with accessible status/error semantics; scoped copy
overrides remain caller-provided.

## Rendering boundaries

Virtualization is opt-in and session-identity keyed; the direct list remains
the simple default. Select and tooltip portals mount under the provider root so
they inherit live scoped theme values and share its stacking scope. The provider
does not add overflow or positioning rules, but an ancestor's transform or
overflow can still affect portal positioning or clipping.

The host defines the timeline viewport. In particular, a virtual timeline needs
a constrained scrolling container around `SessionTimeline` (for example, a
caller-owned height and `overflow: auto`); the component does not promise an
auto-height virtual viewport.

Markdown uses an ESM module worker. Hosts must configure their bundler's worker
output accordingly (Vite uses `worker.format: "es"`); this requirement neither
makes the package dependency-free nor makes it SSR-safe.

The Markdown KaTeX stylesheet is vendored from KaTeX 0.17.0 with an MIT
provenance header. Its full upstream notice is retained in
`LICENSES/KaTeX.txt` (copyright © 2013–2020 Khan Academy and other
contributors). The stylesheet references the KaTeX dependency's font files via
relative `node_modules/katex/dist/fonts` URLs; fonts are not copied into this
package source, so publish/build asset handling must retain those referenced
dependency assets.

## Verification

| Check                          | Verified result                                    |
| ------------------------------ | -------------------------------------------------- |
| `bun run typecheck`            | Pass                                               |
| `bun run test`                 | Pass: 24 unit tests                                |
| `bun run test:browser`         | Pass: 2 browser geometry tests                     |
| `@bymorning/client` typechecks | Pass: `typecheck` and `typecheck:solid` (37 tests) |

These results verify the library contract and geometry fixture. They do not
claim a Web migration or backend change.
