# Third-party notices

ByMorning is released under the MIT License (see `LICENSE`). It includes or is
derived from the following third-party material. Dependencies installed from
npm keep their own licenses; `bun script/security/licenses.ts` reports them from
the release SBOM.

## SST (MIT)

The repository began from the SST monorepo template.

> MIT License. Copyright (c) 2024 SST

## OpenCode (MIT)

Parts of the session, plugin, and web client design and code are ported or
pinned from OpenCode (<https://github.com/sst/opencode>); see the "pinned from
OpenCode" and "vendored" comments in `packages/core/src/session/limit.ts` and
`packages/core/src/plugin/`. The runtime also depends on the `@opencode-ai/*`
packages from npm.

> MIT License. Copyright (c) 2025 opencode

The full MIT permission notice is the one in `LICENSE`.

## models.dev (MIT)

The model catalog source and provider logos under `packages/models/source/models-dev/`
and `packages/web/public/assets/provider-icons/` come from
<https://github.com/anomalyco/models.dev>. See
`packages/web/public/assets/provider-icons/NOTICE.md`. Provider names and logos
may be trademarks of their respective owners.

## KaTeX (MIT)

`packages/session-ui/src/markdown/markdown-katex.css` is KaTeX v0.17.0 CSS,
vendored and scoped. License text: `packages/session-ui/LICENSES/KaTeX.txt`.

## Fonts (SIL Open Font License 1.1)

- Inter
- JetBrains Mono
- Atkinson Hyperlegible Next

Each family's license text sits beside its files in
`packages/ui/src/assets/fonts/` and `packages/web/public/assets/fonts/`.

## Material Icon Theme (MIT)

`packages/ui/src/assets/file-icons/sprite.svg` (and the copy under
`packages/web/src/ui/assets/file-icons/`) is a sprite of file-type icons from
the Material Icon Theme (<https://github.com/material-extensions/vscode-material-icon-theme>).
Its symbols carry that project's icon names (for example `Zeabur`, `Wxt`, and
`Wrangler`) and its path data: the `Zip` symbol is identical to the project's
`icons/zip.svg`. Brand marks inside the sprite belong to their respective
owners.

> MIT License. Copyright (c) 2025 Material Extensions

The full MIT permission notice is the one in `LICENSE`.

## Patched dependencies

`patches/` holds local fixes to three MIT-licensed packages, applied by Bun
through `patchedDependencies`: `@corvu/drawer`, `@opencode-ai/ai`, and
`@tanstack/virtual-core`. The upstream licenses apply to the patched code.
