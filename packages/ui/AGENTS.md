# UI package

- Copy-first design system.
- Supported imports are the explicit package export map. Private implementation
  and generation files are not public APIs.
- No Web, Starter, Session UI, router, SDK, Schema, Core, Query, or server imports.
- Preserve primitive props, defaults, DOM anatomy, tokens, keyboard behavior and
  callback semantics. Record every semantic departure from the pinned source.
- Prefer `createStore` for structured state. Preserve live Solid props and owner
  lifetimes; clean up listeners, observers, timers and dialog roots.
- One document ThemeProvider and one Toast.Region per application. Host layout
  owns viewport sizing. Component CSS must not impose a document theme or reset.
- UI defaults belong in the scoped i18n catalog. Keep existing English copy.
- Theme JSON is validated at build time. Run `theme:generate` after changing the
  generator or definitions, and `theme:check` to verify generated CSS.
- Keep local fonts and notices together; this is a private workspace package.
- Run typecheck, lint, format:check, test, build and test:browser here. The browser
  fixture imports public entrypoints and tests the production build on a nested
  base path. Never restart an existing server.
