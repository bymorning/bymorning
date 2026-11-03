#!/usr/bin/env bun
/**
 * Render the security review package for one release.
 *
 * Reads docs/security/review/NN-*.md in filename order, expands figure
 * directives (docs/security/review/figures/<id>.mmd), substitutes the release
 * placeholders, renders figures to SVG with mermaid in Playwright's Chromium,
 * converts Markdown to HTML with marked, and prints one PDF. The release values
 * come from two places:
 *
 *   <release>/manifest.json, the evidence SHA256SUMS, signer.txt, and
 *   trusted_root.json      version, commit, digest, tarball, and checksums
 *   docs/security/review/release.json
 *                          what a person writes per release: the date, the
 *                          test result, and the scan summaries. Its "VERSION"
 *                          must equal the manifest's, so stale summaries can't
 *                          ship with a new release.
 *
 * The build fails if any {{PLACEHOLDER}} remains unresolved.
 *
 * Output (gitignored): build/security/<version>/
 *   index.html, svg/NN-doc-K.svg, bymorning-security-review-<version>.pdf
 *   figures/<id>.svg / <id>.png             (--figures-only)
 *
 * Usage (the release directory defaults to release/):
 *   bun script/security/render.ts [--release <dir>]                  render the package
 *   bun script/security/render.ts [--release <dir>] --check          lint + overflow check; exit 1 on errors (no PDF)
 *   bun script/security/render.ts [--release <dir>] --figures-only   render figures as SVG+PNG
 *   bun script/security/render.ts --lint                             editorial lint only; no release needed
 *
 * Chromium is Playwright's (bunx playwright install chromium).
 *
 * Shared mermaid classes (injected into every flowchart; do not redefine):
 *   bym  — ByMorning process/component (blue fill)
 *   aws  — cloud-managed service (orange fill)
 *   cust — customer-owned infrastructure (green fill)
 *   ext  — optional/external, disabled unless authorized (gray, dashed border)
 * Apply with `class NODE1,NODE2 bym` after the flowchart declaration. See
 * docs/security/review/figures/README.md.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { marked } from "marked"
import { chromium, type Page } from "@playwright/test"
import { formatReport, lintDocs, PLACEHOLDER_ALLOWLIST, type Finding, type LintDoc } from "./lint-report.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const templateDir = path.join(root, "docs/security/review")

// ---------------------------------------------------------------------------
// Arguments and profile

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : argv[index + 1]
}

const argv = process.argv.slice(2)
const releaseDir = path.resolve(root, option(argv, "release") ?? "release")
const checkOnly = argv.includes("--check")
const figuresOnly = argv.includes("--figures-only")
const lintOnly = argv.includes("--lint")
let outDir = path.join(root, "build/security")
let svgDir = path.join(outDir, "svg")

interface Profile {
  readonly values: Record<string, string>
  readonly version: string
}

const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex")

/** Evidence file -> placeholder, for the checksums chapter 15 lists. */
const EVIDENCE_SUMS: Record<string, string> = {
  "provenance.intoto.json": "PROVENANCE_SHA256",
  "openvex.json": "OPENVEX_SHA256",
  "sbom-image.cyclonedx.json": "SBOM_IMAGE_CDX_SHA256",
  "sbom-image.spdx.json": "SBOM_IMAGE_SPDX_SHA256",
  "sbom-source.cyclonedx.json": "SBOM_SOURCE_SHA256",
  "vulnerabilities-image-grype.json": "VULN_IMAGE_SHA256",
  "vulnerabilities-source-grype.json": "VULN_SOURCE_SHA256",
  "vulnerabilities.md": "VULN_MD_SHA256",
  "licenses.md": "LICENSES_SHA256",
  "gitleaks.json": "GITLEAKS_SHA256",
  "semgrep.sarif": "SEMGREP_SHA256",
  "bun-audit.txt": "BUN_AUDIT_SHA256",
  "tools.txt": "TOOLS_SHA256",
}

async function loadProfile(): Promise<Profile> {
  const manifestFile = path.join(releaseDir, "manifest.json")
  if (!existsSync(manifestFile)) fail(`${path.relative(root, manifestFile)} not found; pass --release <dir>`)
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    version: string
    commit: string
    revision: string
    artifacts: { gateway: { tarball: string; digest: string } }
  }
  const authoredFile = path.join(templateDir, "release.json")
  const authored = JSON.parse(await readFile(authoredFile, "utf8")) as Record<string, string>
  if (authored.VERSION !== manifest.version)
    fail(
      `${path.relative(root, authoredFile)} is for ${authored.VERSION}, but the release is ${manifest.version}; update it`,
    )
  const evidence = path.join(releaseDir, manifest.version, "gateway")
  const sums = new Map<string, string>()
  for (const line of (await readFile(path.join(evidence, "SHA256SUMS"), "utf8")).split("\n")) {
    const match = /^([0-9a-f]{64}) +\*?(.+)$/.exec(line.trim())
    if (match) sums.set(path.basename(match[2]!), match[1]!)
  }
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(authored))
    if (!key.startsWith("_") && typeof value === "string") values[key] = value
  values.SOURCE_COMMIT = manifest.commit
  values.SOURCE_COMMIT_FULL = manifest.revision
  values.IMAGE_DIGEST = manifest.artifacts.gateway.digest
  values.TARBALL_NAME = manifest.artifacts.gateway.tarball
  const tarball = sums.get(manifest.artifacts.gateway.tarball)
  if (!tarball) fail(`SHA256SUMS does not list ${manifest.artifacts.gateway.tarball}`)
  values.TARBALL_SHA256 = tarball
  for (const [file, key] of Object.entries(EVIDENCE_SUMS)) {
    const sum = sums.get(file)
    if (!sum) fail(`SHA256SUMS does not list ${file}`)
    values[key] = sum
  }
  values.SIGNER_SHA256 = await sha256(path.join(releaseDir, "signer.txt"))
  values.TRUSTED_ROOT_SHA256 = await sha256(path.join(releaseDir, "trusted_root.json"))
  return { values, version: manifest.version }
}

/** Substitute {{KEY}} until fixpoint (profile values may reference other keys). */
function substitute(text: string, values: Record<string, string>): string {
  let result = text
  for (let pass = 0; pass < 5; pass++) {
    const next = result.replace(/\{\{([A-Z0-9_]+)\}\}/g, (original, key: string) => values[key] ?? original)
    if (next === result) return result
    result = next
  }
  throw new Error("placeholder substitution did not converge (cyclic profile values?)")
}

function unresolvedPlaceholders(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
    if (!PLACEHOLDER_ALLOWLIST.has(match[1]!)) keys.add(match[1]!)
  }
  return [...keys]
}

// ---------------------------------------------------------------------------
// Includes and figures (directives resolved at assembly; SVG at render)

async function figureSource(id: string): Promise<{ file: string; text: string }> {
  const file = path.join(templateDir, "figures", `${id}.mmd`)
  if (!existsSync(file)) throw new Error(`figure ${id} not found in ${path.relative(root, templateDir)}/figures`)
  return { file, text: await readFile(file, "utf8") }
}

/** Figures referenced by the docs but missing on disk (collected at render). */
const renderProblems: Finding[] = []

export interface Assembled {
  readonly profile: Profile
  readonly docs: { file: string; title: string; body: string }[]
}

/** Frontmatter stripped, includes expanded, placeholders substituted. */
export async function assemble(profile: Profile): Promise<Assembled> {
  const files = (await readdir(templateDir)).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort()
  if (files.length === 0) fail(`No markdown documents in ${templateDir}`)
  const docs: Assembled["docs"] = []
  const unresolved = new Map<string, string[]>()
  for (const file of files) {
    const source = await readFile(path.join(templateDir, file), "utf8")
    const { title, body } = parseFrontmatter(source)
    if (/^\s*!\[\[include:/m.test(body)) fail(`${file}: include directives are not supported`)
    const substituted = substitute(body, profile.values)
    const missing = unresolvedPlaceholders(substituted)
    if (missing.length) unresolved.set(file, missing)
    docs.push({ file, title, body: substituted })
  }
  if (unresolved.size) {
    const detail = [...unresolved.entries()].map(([file, keys]) => `  ${file}: ${keys.join(", ")}`).join("\n")
    fail(`unresolved placeholders (add them to docs/security/review/release.json or the renderer):\n${detail}`)
  }
  return { profile, docs }
}

// ---------------------------------------------------------------------------
// Mermaid rendering

const mermaidConfig = {
  theme: "default",
  themeVariables: { fontSize: "17px" },
  // padding and subGraphTitleMargin keep a subgraph's title clear of its
  // top-most node; with the 8px default the title sits under the node box.
  flowchart: {
    htmlLabels: true,
    wrappingWidth: 180,
    nodeSpacing: 20,
    rankSpacing: 22,
    padding: 12,
    subGraphTitleMargin: { top: 6, bottom: 10 },
  },
  sequence: { wrap: true },
}

/**
 * Shared classDefs injected into every flowchart (sequence and pie diagrams do
 * not support classDef). Figures must not redefine these names; see the header
 * comment and docs/security/review/figures/README.md.
 */
const FLOWCHART_CLASSES = [
  "classDef bym fill:#e8f0fe,stroke:#3b6fd4,stroke-width:1px,color:#17233b",
  "classDef aws fill:#fff2e0,stroke:#c27400,stroke-width:1px,color:#3d2b00",
  "classDef cust fill:#e6f4ea,stroke:#2e7d43,stroke-width:1px,color:#12351d",
  "classDef ext fill:#f5f5f5,stroke:#757575,stroke-width:1px,color:#333333,stroke-dasharray:6 4",
].join("\n")

function withSharedClasses(mmd: string): string {
  return mmd.replace(/^[ \t]*(?:flowchart|graph)\b[^\n]*$/m, (line) => `${line}\n${FLOWCHART_CLASSES}`)
}

/** mermaid's browser bundle, from the web packages that already depend on it. */
const mermaidBundle = createRequire(path.join(root, "packages/web/package.json")).resolve("mermaid/dist/mermaid.min.js")

/** One Chromium page with mermaid loaded; figures render through it in order. */
async function figureRenderer() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setContent("<!doctype html><html><body></body></html>")
  await page.addScriptTag({ path: mermaidBundle })
  await page.evaluate((config) => {
    const m = (window as unknown as { mermaid: { initialize: (c: unknown) => void } }).mermaid
    m.initialize({ startOnLoad: false, securityLevel: "strict", ...config })
  }, mermaidConfig)
  let count = 0
  const render = async (text: string): Promise<string> => {
    count += 1
    return page.evaluate(
      async ({ id, text }) => {
        const m = (window as unknown as { mermaid: { render: (id: string, text: string) => Promise<{ svg: string }> } })
          .mermaid
        return (await m.render(id, text)).svg
      },
      { id: `figure-${count}`, text },
    )
  }
  /** A 2x PNG of one SVG, for --figures-only. */
  const png = async (svg: string, file: string) => {
    const shot = await browser.newPage({ deviceScaleFactor: 2 })
    await shot.setContent(`<!doctype html><html><body style="margin:0;background:white">${svg}</body></html>`)
    await shot.locator("svg").first().screenshot({ path: file })
    await shot.close()
  }
  return { render, png, page: page as Page, close: () => browser.close() }
}

type Renderer = Awaited<ReturnType<typeof figureRenderer>>

/** Natural pixel size from the SVG viewBox mermaid emits. */
function figureNaturalSize(svg: string): { width: number; height: number } | undefined {
  const parts = /viewBox="\s*([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*"/.exec(svg)
  if (!parts) return undefined
  return { width: Number(parts[3]), height: Number(parts[4]) }
}

/**
 * Mermaid emits <svg width="100%"> plus an inline max-width of the natural
 * pixel width, so every figure stretches to the full column (small figures
 * included) and an over-tall one overflows the page. Replace the percentage
 * with an explicit pixel width — the natural width capped at the content
 * column — and let the viewBox ratio (plus the stylesheet max-height) size
 * the height. Also enforce the readability floor: scaled past 8.5pt effective
 * mermaid font, the figure must be split or re-laid out instead.
 */
function sizeFigure(svg: string, landscape: boolean, docName: string, id: string): string {
  const natural = figureNaturalSize(svg)
  if (!natural) return svg
  const capW = landscape ? CONTENT_WIDTH_LANDSCAPE : CONTENT_WIDTH
  const capH = landscape ? FIGURE_MAX_HEIGHT_LANDSCAPE : FIGURE_MAX_HEIGHT_PORTRAIT
  const effectiveFont = Math.min(1, capW / natural.width, capH / natural.height) * MERMAID_FONT_PT
  if (effectiveFont < FIGURE_FONT_FLOOR_PT) {
    renderProblems.push({
      rule: "figure-scale",
      severity: "error",
      file: `${docName}.md`,
      line: 0,
      message:
        `figure ${id} is ${Math.round(natural.width)}×${Math.round(natural.height)}px; ` +
        `at the page cap its effective font is ${effectiveFont.toFixed(1)}pt (< ${FIGURE_FONT_FLOOR_PT}pt) — split or re-lay it out`,
    })
  }
  const width = Math.round(Math.min(natural.width, capW))
  return svg.replace(/<svg([^>]*?)\swidth="100%"/, `<svg$1 width="${width}"`)
}

async function renderFigures(docName: string, markdown: string, profile: Profile, renderer: Renderer): Promise<string> {
  // [ \t] only: a \s*$ here would swallow the blank line after the directive,
  // gluing the caption to the diagram div so marked never parses the emphasis.
  // Directive: ![[figure:<id>]] or ![[figure:<id> landscape]] — the latter
  // renders on a dedicated landscape page (wide figures only; see README).
  const directives = [...markdown.matchAll(/^[ \t]*!\[\[figure:([\w-]+)(?:[ \t]+(landscape))?\]\][ \t]*$/gm)]
  let result = markdown
  for (const directive of directives) {
    const id = directive[1]!
    const landscape = directive[2] === "landscape"
    let text: string
    try {
      text = (await figureSource(id)).text
    } catch (error) {
      // Report and continue: --check must surface every problem in one pass.
      renderProblems.push({
        rule: "figure-missing",
        severity: "error",
        file: `${docName}.md`,
        line: 0,
        message: (error as Error).message,
      })
      result = result.replace(
        directive[0],
        () => `<div class="mermaid-diagram" id="fig-${id}">\n<p>figure ${id} not found</p>\n</div>`,
      )
      continue
    }
    const svg = await renderer.render(withSharedClasses(substitute(text, profile.values)))
    await writeFile(path.join(svgDir, `${docName}-${id}.svg`), svg)
    const rendered = sizeFigure(svg, landscape, docName, id)
    // Function replacer: the SVG may contain $-sequences (label text).
    const cls = landscape ? "mermaid-diagram landscape" : "mermaid-diagram"
    result = result.replace(directive[0], () => `<div class="${cls}" id="fig-${id}">\n${rendered}\n</div>`)
    console.log(`  figure ${id} ok`)
  }
  return result
}

/** Standalone SVG+PNG per figure, for visual review outside the package. */
async function renderFiguresOnly(profile: Profile, renderer: Renderer) {
  const figuresDir = path.join(outDir, "figures")
  await mkdir(figuresDir, { recursive: true })
  const files = (await readdir(path.join(templateDir, "figures"))).filter((f) => f.endsWith(".mmd")).sort()
  for (const file of files) {
    const id = file.replace(/\.mmd$/, "")
    const svg = await renderer.render(
      withSharedClasses(substitute(await readFile(path.join(templateDir, "figures", file), "utf8"), profile.values)),
    )
    await writeFile(path.join(figuresDir, `${id}.svg`), svg)
    await renderer.png(svg, path.join(figuresDir, `${id}.png`))
    console.log(`  figure ${id} ok (svg + png)`)
  }
  console.log(`\nwrote ${path.relative(root, figuresDir)} (${files.length} figures)`)
}

// ---------------------------------------------------------------------------
// Markdown → HTML

interface Doc {
  readonly file: string
  readonly slug: string
  readonly title: string
  html: string
  headings: { level: number; text: string; id: string }[]
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function parseFrontmatter(source: string): { title: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  if (!match) return { title: "", body: source }
  const title = /^title:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim() ?? ""
  return { title, body: source.slice(match[0].length) }
}

function addHeadingIds(html: string): { html: string; headings: Doc["headings"] } {
  const headings: Doc["headings"] = []
  const out = html.replace(/<h([12])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim()
    const id = slugify(text)
    headings.push({ level: Number(level), text, id })
    return `<h${level} id="${id}">${inner}</h${level}>`
  })
  return { html: out, headings }
}

/** Fold a diagram div followed by an italic caption paragraph into figure/figcaption. */
export function captions(html: string): string {
  return html.replace(
    /<div class="mermaid-diagram([^>]*)>([\s\S]*?)<\/div>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    (_m, attrs: string, svg: string, caption: string) =>
      `<figure class="diagram${attrs.includes("landscape") ? " landscape" : ""}"><div class="mermaid-diagram"${attrs}>${svg}</div><figcaption>${caption}</figcaption></figure>`,
  )
}

/** Highlight allowlisted placeholders that intentionally survive substitution. */
function highlightPlaceholders(html: string): string {
  return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (original, key: string) =>
    PLACEHOLDER_ALLOWLIST.has(key) ? `<mark class="placeholder">${original}</mark>` : original,
  )
}

// ---------------------------------------------------------------------------
// Page assembly

/** Portrait figure height budget: 9.5in content minus caption and margins. */
const FIGURE_MAX_HEIGHT_PORTRAIT = 8.8 * 96
/** Landscape content height is 7.0in; leave room for the caption. */
const FIGURE_MAX_HEIGHT_LANDSCAPE = 6.2 * 96
/** Landscape content width: (11in − 2×0.75in) × 96 = 912 CSS px. */
const CONTENT_WIDTH_LANDSCAPE = 912
/** Mermaid renders at a 17px base font; figures must stay ≥ 8.5pt at print. */
const MERMAID_FONT_PT = 17 * 0.75
const FIGURE_FONT_FLOOR_PT = 8.5

const stylesheet = `
  @page { size: Letter; margin: 0.75in; }
  /* Wide figures flagged "landscape" get a dedicated rotated page. Content
     width there is (11in − 2×0.75in) × 96 = 912 CSS px. */
  @page landscape { size: Letter landscape; margin: 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.25; color: #1a1a1a; margin: 0; }
  code, pre, .mermaid-diagram text { font-family: "SF Mono", Menlo, Consolas, monospace; }
  code { background: #f2f2f2; padding: 0 3px; border-radius: 3px; font-size: 8.8pt; }
  pre { background: #f7f7f7; border: 1px solid #e2e2e2; border-radius: 4px; padding: 6px 8px; font-size: 8.5pt; white-space: pre-wrap; word-break: break-word; margin: 0.6em 0; }
  pre code { background: none; padding: 0; }
  h1 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 4px; margin: 0 0 0.5em; }
  h2 { font-size: 12.5pt; margin: 0.7em 0 0.25em; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 0.7em 0 0.25em; page-break-after: avoid; }
  p, ul, ol { margin: 0.45em 0; }
  li { margin: 0.12em 0; }
  li > ul, li > ol { margin: 0.12em 0; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; line-height: 1.22; margin: 0.5em 0; }
  th, td { border: 1px solid #bbb; padding: 2px 4px; text-align: left; vertical-align: top; }
  /* Long unbreakable tokens (digests, ARNs, paths) must not push a table past
     the content width. */
  td code { word-break: break-all; }
  th { background: #ececec; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  figure.diagram { margin: 0.7em 0; page-break-inside: avoid; text-align: center; }
  /* Figures render at their natural width capped at the content column (set
     per figure in renderFigures); max-height keeps an over-tall figure on one
     page without distorting it. */
  figure.diagram svg { max-width: 100%; max-height: ${FIGURE_MAX_HEIGHT_PORTRAIT / 96}in; height: auto; }
  /* A named page forces the breaks around the figure by itself; explicit
     break-before/after here would add blank pages. */
  figure.diagram.landscape { page: landscape; margin: 0; }
  figure.diagram.landscape svg { max-height: ${FIGURE_MAX_HEIGHT_LANDSCAPE / 96}in; }
  figcaption { font-size: 8.8pt; font-style: italic; color: #444; margin-top: 3px; text-align: left; }
  mark.placeholder { background: #ffe58f; border-bottom: 2px solid #d48806; padding: 0 2px; }
  /* Every chapter starts on a fresh page. */
  section.doc { page-break-before: always; }
  section.doc h1 { page-break-after: avoid; }
  section.cover { height: 8.6in; display: flex; flex-direction: column; justify-content: center; }
  section.cover .band { border-top: 3px solid #333; border-bottom: 3px solid #333; padding: 28px 0; }
  section.cover h1 { border: none; font-size: 22pt; margin: 0 0 14px; }
  section.cover table.meta { width: auto; font-size: 11pt; line-height: 1.4; margin: 0; }
  section.cover table.meta th, section.cover table.meta td { border: none; padding: 4px 18px 4px 0; }
  section.cover table.meta th { background: none; font-weight: bold; white-space: nowrap; }
  section.cover table.meta code { font-size: 8.8pt; white-space: nowrap; }
  section.cover .marking { text-align: center; font-weight: bold; letter-spacing: 0.06em; margin-bottom: 40px; }
  nav.toc { page-break-before: always; }
  nav.toc h1 { border-bottom: 2px solid #333; }
  nav.toc ul { list-style: none; padding-left: 0; line-height: 1.25; columns: 2; column-gap: 28px; }
  nav.toc li { margin: 0; break-inside: avoid; }
  nav.toc li.l2 { padding-left: 18px; font-size: 9pt; }
  nav.toc a { color: #1a1a1a; text-decoration: none; }
  blockquote { border-left: 3px solid #999; margin: 0.45em 0 0.45em 0; padding-left: 12px; color: #444; }
  hr { border: none; border-top: 1px solid #999; margin: 0.6em 0; }
`

/** The package is public; the marking says so on every page. */
const MARKING = "Public"

function headerTemplate(marking: string, title: string): string {
  return `<div style="width:100%;font-size:7pt;padding:0 0.75in;display:flex;justify-content:space-between;color:#333;">
    <span>${title}</span><span style="font-weight:bold;">${marking}</span></div>`
}

function footerTemplate(marking: string): string {
  return `<div style="width:100%;font-size:7pt;padding:0 0.75in;display:flex;justify-content:space-between;color:#333;">
    <span>${marking}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
}

function coverPage(profile: Profile): string {
  const v = (key: string) => profile.values[key] ?? `{{${key}}}`
  const rows: [string, string][] = [
    ["Prepared by", "The ByMorning team"],
    ["Product", `ByMorning ${profile.version}`],
    ["Image digest", `<code>${v("IMAGE_DIGEST")}</code>`],
    ["Release date", v("RELEASE_DATE")],
    ["Framework", "CMMC Level 2 / NIST SP 800-171 Rev 2"],
  ]
  const meta = rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("\n")
  return `<section class="cover">
    <div class="marking">${MARKING}</div>
    <div class="band">
      <h1>Security Review Package</h1>
      <table class="meta">${meta}</table>
    </div>
  </section>`
}

/**
 * Chapter number shown in the contents and the chapter heading: document NN
 * renders as chapter N; document 00 (the cover letter) is unnumbered.
 */
function chapterNumber(file: string): number {
  return Number(/^(\d\d)/.exec(file)?.[1] ?? "0")
}

/**
 * Prefix the document's first <h1> with its chapter number. Runs before
 * addHeadingIds so the contents entry and the chapter heading agree.
 */
function numberHeading(html: string, file: string): string {
  const n = chapterNumber(file)
  if (!n) return html
  return html.replace(/<h1>/, `<h1>${n} `)
}

function tocPage(docs: Doc[]): string {
  const items = docs
    .map((doc) => {
      const subs = doc.headings
        .filter((h) => h.level === 2)
        .map((h) => `<li class="l2"><a href="#${h.id}">${h.text}</a></li>`)
        .join("\n")
      const top = doc.headings.find((h) => h.level === 1)
      const title = top?.text ?? doc.title
      const href = top ? `#${top.id}` : `#doc-${doc.slug}`
      return `<li class="l1"><a href="${href}">${title}</a></li>${subs}`
    })
    .join("\n")
  return `<nav class="toc"><h1 id="contents">Contents</h1><ul>${items}</ul></nav>`
}

function buildPage(docs: Doc[], profile: Profile): string {
  const body = docs.map((doc) => `<section class="doc" id="doc-${doc.slug}">\n${doc.html}\n</section>`).join("\n")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ByMorning ${profile.version} Security Review Package</title>
<style>${stylesheet}</style></head>
<body>
${coverPage(profile)}
${tocPage(docs)}
${body}
</body></html>`
}

// ---------------------------------------------------------------------------
// Overflow check (Playwright): catches labels and blocks the PDF would clip
// or shrink past readability at Letter print width.

/** Letter content width in CSS px: (8.5in − 2×0.75in) × 96. */
const CONTENT_WIDTH = 672

/**
 * Detects mermaid label text that exceeds its box (HTML labels: foreignObject
 * divs; plain labels: svg text vs the node shape) and any table/pre/figure
 * wider than the page content width. Runs against the assembled page laid out
 * at exactly the print content width.
 */
async function findOverflow(htmlPath: string): Promise<Finding[]> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: CONTENT_WIDTH, height: 1200 } })
    const tab = await context.newPage()
    await tab.goto(`file://${htmlPath}`, { waitUntil: "load" })
    const hits = await tab.evaluate(() => {
      interface Hit {
        doc: string
        figure: string
        kind: "label" | "text" | "width"
        detail: string
      }
      const hits: Hit[] = []
      const contentWidth = document.documentElement.clientWidth
      const locate = (el: Element): { doc: string; figure: string } => {
        const fig = el.closest('[id^="fig-"]')
        const doc = el.closest("section.doc")
        return { doc: doc ? doc.id.replace(/^doc-/, "") : "", figure: fig ? fig.id.replace(/^fig-/, "") : "" }
      }
      const snippet = (el: Element): string => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48)
      // Mermaid HTML labels: the foreignObject's div has a fixed box.
      for (const fo of document.querySelectorAll(".mermaid-diagram foreignObject")) {
        const inner = fo.firstElementChild
        if (!(inner instanceof HTMLElement)) continue
        const overW = inner.scrollWidth - inner.clientWidth
        const overH = inner.scrollHeight - inner.clientHeight
        if (overW > 2 || overH > 2) {
          hits.push({
            ...locate(fo),
            kind: "label",
            detail: `label "${snippet(inner)}" overflows its box by ${Math.max(overW, 0)}×${Math.max(overH, 0)}px`,
          })
        }
      }
      // Plain SVG labels: text wider/taller than the node shape it sits on.
      for (const text of document.querySelectorAll(".mermaid-diagram svg text")) {
        const node = text.closest("g.node")
        if (!node) continue
        const shape = node.querySelector("rect, polygon, circle, ellipse")
        if (!(shape instanceof SVGGraphicsElement)) continue
        const tb = (text as SVGGraphicsElement).getBBox()
        const sb = shape.getBBox()
        const overW = tb.width - sb.width
        const overH = tb.height - sb.height
        if (overW > 2 || overH > 2) {
          hits.push({
            ...locate(text),
            kind: "text",
            detail: `text "${snippet(text)}" exceeds its shape by ${Math.max(overW, 0).toFixed(0)}×${Math.max(overH, 0).toFixed(0)}px`,
          })
        }
      }
      // Blocks wider than the page content column.
      for (const el of document.querySelectorAll("table, pre, figure.diagram")) {
        const r = el.getBoundingClientRect()
        if (r.width > contentWidth + 1) {
          hits.push({
            ...locate(el),
            kind: "width",
            detail: `${el.tagName.toLowerCase()} "${snippet(el)}" is ${Math.round(r.width)}px wide; content width is ${contentWidth}px`,
          })
        }
      }
      return hits
    })
    return hits.map((hit) => ({
      rule: "overflow",
      severity: "error" as const,
      file: hit.doc ? `${hit.doc}.md` : "(page)",
      line: 0,
      message: `${hit.figure ? `figure ${hit.figure}: ` : ""}${hit.detail}`,
    }))
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  if (lintOnly) {
    const files = (await readdir(templateDir)).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort()
    const docs: LintDoc[] = []
    for (const file of files)
      docs.push({ file, text: parseFrontmatter(await readFile(path.join(templateDir, file), "utf8")).body })
    // Release placeholders are filled at render time; everything else must pass.
    const findings = lintDocs(docs).filter((f) => f.rule !== "unresolved-placeholder")
    console.log(formatReport(findings) || "security review lint — 0 errors, 0 warnings")
    if (findings.some((f) => f.severity === "error")) process.exit(1)
    return
  }

  const profile = await loadProfile()
  outDir = path.join(root, "build/security", profile.version)
  svgDir = path.join(outDir, "svg")
  // Only a full render replaces the output directory; --check and
  // --figures-only leave a rendered package in place.
  if (figuresOnly) {
    await rm(path.join(outDir, "figures"), { recursive: true, force: true })
  } else if (!checkOnly) {
    await rm(outDir, { recursive: true, force: true })
  }
  await mkdir(svgDir, { recursive: true })

  const { docs: assembled } = await assemble(profile)

  const lintDocsInput: LintDoc[] = assembled.map((doc) => ({ file: doc.file, text: doc.body }))
  const findings = lintDocs(lintDocsInput)
  const errors = findings.filter((f) => f.severity === "error")

  const renderer = await figureRenderer()
  try {
    if (figuresOnly) {
      await renderFiguresOnly(profile, renderer)
      return
    }

    const renderDocs = async (): Promise<Doc[]> => {
      const docs: Doc[] = []
      for (const { file, title, body } of assembled) {
        const slug = file.replace(/\.md$/, "")
        console.log(`rendering ${file}`)
        const withSvg = await renderFigures(slug, body, profile, renderer)
        const html = numberHeading(captions(await marked.parse(withSvg)), file)
        const headed = addHeadingIds(html)
        docs.push({ file, slug, title, headings: headed.headings, html: headed.html })
      }
      return docs
    }

    if (checkOnly) {
      // Lint plus a rendered overflow check; no PDF, no output-dir wipe.
      const docs = await renderDocs()
      const checkHtml = path.join(outDir, ".check.html")
      await writeFile(checkHtml, highlightPlaceholders(buildPage(docs, profile)))
      let overflow: Finding[] = []
      try {
        overflow = await findOverflow(checkHtml)
      } finally {
        await rm(checkHtml, { force: true })
      }
      const all = [...findings, ...renderProblems, ...overflow]
      console.log(formatReport(all))
      if (all.some((f) => f.severity === "error")) process.exit(1)
      return
    }

    if (errors.length) {
      console.error(formatReport(errors))
      fail(`lint reported ${errors.length} errors; fix them before rendering`)
    }
    const warnings = findings.filter((f) => f.severity === "warning")
    console.log(`lint: 0 errors, ${warnings.length} warnings (run --check for the full list)`)

    const docs = await renderDocs()
    if (renderProblems.length) {
      console.error(formatReport(renderProblems))
      fail(`${renderProblems.length} figure problem(s); fix them before rendering`)
    }
    const page = buildPage(docs, profile)

    const htmlPath = path.join(outDir, "index.html")
    await writeFile(htmlPath, highlightPlaceholders(page))

    const overflow = await findOverflow(htmlPath)
    if (overflow.length) {
      console.error(formatReport(overflow))
      fail(`overflow check reported ${overflow.length} errors; fix the figures before rendering the PDF`)
    }

    const pdfPath = path.join(outDir, `bymorning-security-review-${profile.version}.pdf`)
    const browser = await chromium.launch({ headless: true })
    try {
      const tab = await (await browser.newContext()).newPage()
      await tab.goto(`file://${htmlPath}`, { waitUntil: "load" })
      await tab.pdf({
        path: pdfPath,
        // Named pages (landscape figures) come from the stylesheet.
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerTemplate(MARKING, `ByMorning ${profile.version} — Security Review Package`),
        footerTemplate: footerTemplate(MARKING),
        margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
      })
    } finally {
      await browser.close()
    }
    console.log(`\nwrote ${path.relative(root, htmlPath)}`)
    console.log(`wrote ${path.relative(root, pdfPath)}`)
    console.log(
      `${docs.length} documents, ${docs.reduce((n, d) => n + (d.html.match(/mermaid-diagram/g) ?? []).length, 0)} diagrams`,
    )
  } finally {
    await renderer.close()
  }
}

if (import.meta.main) await main()
