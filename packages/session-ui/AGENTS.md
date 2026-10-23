# Session UI package instructions

- This package is presentation-only. Do not import application runtime, router,
  query, Core, or SDK clients at runtime.
- `@bymorning/client` imports are type-only. Callers own data reconciliation and
  pass ordered, deduplicated rows and explicit actions.
- Never hardcode user-visible copy in components; obtain it from the scoped
  `SessionProvider` labels.
- Keep all CSS under `[data-session-ui]`. Do not add global resets, body rules,
  theme persistence, or theme selectors.
- A nested provider's supplied tool map replaces inherited tools. Do not add a
  global tool registry.
- Keep the public entrypoint limited to the documented presentation components,
  `Markdown`, and `SessionUI` types. Do not make adapters, runtime stores, or
  private primitives public exports.
- Rows arrive in application order (Message, Inbox, Submission). Actions only
  signal intent through `run(): void`; do not add reconciliation, rejection
  handling, or inferred Session status here.
- Markdown's module worker requires an ESM worker-capable host configuration.
  It is not an SSR guarantee.
- Virtual timeline callers own a constrained scrolling viewport; do not add an
  implicit component height or overflow rule to manufacture one.
