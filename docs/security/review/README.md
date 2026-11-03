# Security review package — internal guide

This directory is the source of the ByMorning security review package: one
generic package per release that any organization deploying ByMorning can
hand to its security team. It covers both reference installers (AWS and
Azure) and names no customer, Region, or identity provider. This README is
internal: the renderer reads only the `NN-*.md` documents, so this file is
never rendered into a package.

## Layout

```text
docs/security/review/                 package source
  NN-*.md                               the 16 documents, in package order
  figures/<id>.mmd                      Mermaid sources, included via ![[figure:<id>]]
  figures/README.md                     figure inventory and shared classes
  release.json                          the per-release values a person writes
  README.md                             this file (internal)
docs/security/evidence/               authored per-release evidence: openvex.json and
                                      vulnerability-triage.md (shipped with the release)
release/manifest.json                 the release record the renderer reads
release/<version>/{gateway,execution}/ the signed evidence folders
build/security/<version>/             rendered output (gitignored)
```

## What changes per release

The documents are generic prose plus per-release placeholders: `{{VERSION}}`,
`{{RELEASE_DATE}}`, `{{SOURCE_COMMIT}}`, `{{SOURCE_COMMIT_FULL}}`,
`{{IMAGE_DIGEST}}`, `{{TARBALL_NAME}}`, `{{TARBALL_SHA256}}`, `{{RESULT}}`, the
scan summaries (`{{VULN_SUMMARY}}`, `{{GITLEAK_SUMMARY}}`,
`{{SEMGREP_SUMMARY}}`, `{{BUN_AUDIT_SUMMARY}}`), and the artifact checksums in document 15 (`{{*_SHA256}}`, including
`{{SIGNER_SHA256}}` and `{{TRUSTED_ROOT_SHA256}}`). There are no customer
placeholders: write "the customer" for the organization that deploys and
operates ByMorning, and describe both installers where they differ.

In the rendered package, release values are stated once: in the "Release
identification" block of document 00 and in document 15. Other documents never
repeat a digest, version, commit, or date. Use the placeholder (for example
`{{VULN_SUMMARY}}`) where prose must stay current with the release.

## Rendering a release

1. **Build and sign the release.** The `full-gate` workflow, dispatched with
   `sign=true` on the `v<version>` tag, builds both images, writes
   `release/manifest.json` and the evidence folders, signs them keylessly, and
   publishes the images (see the repository README, "Releases"). Author or
   re-verify `docs/security/evidence/openvex.json` and
   `vulnerability-triage.md` before the build; both are release-scoped.
2. **Write `release.json`.** Set `VERSION` (it must equal the manifest's),
   `RELEASE_DATE`, `RESULT`, and the scan summaries from the release evidence
   (`vulnerabilities.md`, `gitleaks.json`, `semgrep.sarif`, `bun-audit.txt`).
   The renderer reads everything else from the release directory: the commit,
   digest, and tarball from `manifest.json`, the checksums from the Gateway
   `SHA256SUMS`, and the hashes of `signer.txt` and `trusted_root.json`. The
   control summary in document 01 is written out; update it whenever the §4.12
   rollup changes.
3. **Render.** `bun run security:render -- --release <release directory>`
   (default `release/`) writes `build/security/<version>/` (HTML and PDF), with
   figures rendered by mermaid in Playwright's Chromium
   (`bunx playwright install chromium` once). The render fails if any `{{KEY}}`
   is unresolved, an editorial lint rule errors, or a figure or table overflows.
4. **Check.** `bun run security:render -- --release <dir> --check` prints
   the editorial findings and exits non-zero on errors. `--figures-only`
   renders every figure as standalone SVG and PNG under
   `build/security/<version>/figures/` for visual review.

## Editorial conventions

The package renders as one PDF (about 50 pages, each chapter starting on a
new page), so write for a reader who has the whole thing in hand:

- Document NN renders as chapter N; the renderer prefixes the H1 and the
  contents entry, so source H1s carry no number (`# Threat Model`, not
  `# 10 — Threat Model`). Document 00 is the unnumbered cover letter.
- Cross-reference by section only: `§6.3`, `§11`, never `document 06 §6.3` or
  `` `06-secure-configuration-guide.md` ``. The xref lint resolves `§x.y` to
  chapter x.
- Cite test evidence by suite (`SEC-SESS`), not by ID range
  (`SEC-SESS-01…12`); §11.2 maps suites to IDs.
- Write full sentences. No "Summary" bullet blocks, no "Process facts:" lead-in
  fragments, no bold-for-emphasis in prose (bold is reserved for table headers
  the renderer produces). Prefer a paragraph to a bullet list unless the items
  are genuinely parallel.
- Do not address the reader as "you" in documents 01–15; write "the customer".
- Drop parenthetical asides that a security reviewer does not need to act on
  (tool trivia, internal file names).
- No meta-commentary. The reader is the customer's security team, not the
  author: nothing about how the package is organized, which chapter states
  what, how cells are populated, which branch a build came from, or what a
  future release will do differently. State the fact, cite the section, stop.
- Cut to what a security reviewer needs to reach a decision; they will ask
  for more. Operational detail (install steps, restore commands, log queries)
  stays minimal and points at the installer READMEs.
- Never claim a control the code does not have. Verify against the code,
  the installers, and the release workflow before stating a fact.
- Every figure must earn its page. The package keeps four: system context, the
  two halves of the trust-boundary data flow diagram shared by §2.6 and §10,
  and the CUI data flow. Add one only when a table or paragraph cannot say it.

## Editorial lint rules

`script/security/lint-report.ts` (run via `render.ts --check`):

1. `sentence-length` (error) — no prose sentence over 45 words. Wrapped
   paragraphs, list items, and table cells are joined before splitting; code
   blocks and headings excluded, table cell prose included.
2. `unresolved-placeholder` (error) — no `{{KEY}}` left after substitution.
3. `heading-numbering` (error) — numbered headings in document NN start with NN
   (NIST requirement IDs such as 3.1.1 are fine in tables; family sections cite
   the family in parentheses, e.g. `4.2 Access Control (3.1)`).
4. `figure-numbering` (error) — figure IDs match the document number; every
   figure has a caption and vice versa. `figure-not-referenced` (warning) —
   every figure should be referenced from prose.
5. `xref` (error) — every `§x.y` reference names a section that exists. `§x.y`
   resolves to chapter x (document 0x); an explicit `document NN §x.y` prefix
   is still accepted. Soft-wrapped references resolve.
6. `banned-phrase` (warning) — AI-isms and reviewer-hostile phrasing (seed list
   in `lint-report.ts`).
7. `internal-path` (warning) — no references to ByMorning-internal source paths
   (`packages/`, `plugins/`, `app/host`, `script/`, `installers/`,
   `*.ts`) in customer-facing text. Customer-visible release and installer
   files (`release/signer.txt`, Terraform outputs) are fine.
8. `overflow` (error; enforced by the renderer's Playwright pass in
   `render.ts`, not by lint-report.ts) — no mermaid label overflows its node
   box; no table, pre, or figure is wider than the content column. Table cells
   with long hashes/digests wrap (`td code { word-break: break-all }`).
