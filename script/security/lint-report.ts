#!/usr/bin/env bun
/**
 * Editorial lint for the security review package. Pure rules over assembled
 * Markdown documents (placeholders substituted, includes expanded, figure
 * directives intact). `render.ts --check` runs this and exits non-zero on
 * errors; warnings are advisory and collected in build/security/lint-baseline.txt.
 *
 * Rules:
 *   sentence-length        error    prose sentence over 45 words. Wrapped
 *                                   paragraphs, list items, and table cells are
 *                                   joined before sentence splitting; inline
 *                                   code counts as one word; code blocks and
 *                                   headings excluded. Sentences split on
 *                                   . ! ? followed by space + capital (or end),
 *                                   ignoring abbreviations (e.g. i.e. U.S. vs.
 *                                   No.) and decimals/versions.
 *   unresolved-placeholder error    {{KEY}} left after substitution (allowlist below)
 *   heading-numbering      error    a numbered heading in doc NN must start with NN
 *   figure-numbering       error    figure ID must start with the doc number; every
 *                                   figure needs a caption and vice versa
 *   figure-not-referenced  warning  figure never mentioned outside its caption
 *   xref                   error    §x.y reference names a section that does not
 *                                   exist (§x.y resolves to chapter x, i.e. document
 *                                   0x; "document NN §x.y" / `NN` §x.y still accepted)
 *   banned-phrase          warning  AI-isms and reviewer-hostile phrasing
 *   internal-path          warning  ByMorning-internal source paths/scripts
 */
export interface LintDoc {
  readonly file: string
  readonly text: string
}

export interface Finding {
  readonly rule: string
  readonly severity: "error" | "warning"
  readonly file: string
  readonly line: number
  readonly message: string
}

/** Placeholders allowed to survive substitution; they render highlighted. */
export const PLACEHOLDER_ALLOWLIST = new Set(["SECURITY_CONTACT", "SECURITY_PGP"])

const BANNED_PHRASES = [
  "a reviewer",
  "reviewer can",
  "we want a reviewer",
  "anchor on",
  "is repeated here only",
  "any check that fails is a finding",
  "in brief",
  "rather than in testing",
  "it's worth noting",
  "note that",
  "delve",
  "robust",
  "comprehensive",
  "seamless",
  "leverage",
]

const INTERNAL_PATHS: [RegExp, string][] = [
  [/\bpackages\//, "packages/"],
  [/\bplugins\//, "plugins/"],
  [/\bapp\/host\b/, "app/host"],
  [/\bscript\//, "script/"],
  [/\binstallers\//, "installers/"],
  [/[\w@./~-]+\.tsx?\b/, ".ts path"],
]

const SENTENCE_WORD_LIMIT = 45

interface Segment {
  readonly line: number
  readonly text: string
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/
const TABLE_ROW = /^\s*\|/

/** True when a table row is the | --- | --- | separator. */
function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line)
}

/**
 * Splits a document into lintable prose segments with 1-based line numbers.
 * Wrapped lines are joined into their logical block first — a paragraph, one
 * list item (including its continuation lines), one blockquote paragraph, or
 * one table cell — so sentences spanning source lines are linted whole.
 */
function proseSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let inCode = false
  let inComment = false
  // Current accumulated block: its starting line, the joined lines, and
  // whether it is a blockquote (blockquote lines join only with each other).
  let block: { line: number; quoted: boolean; lines: string[] } = { line: 0, quoted: false, lines: [] }
  const flush = () => {
    if (block.lines.length) segments.push({ line: block.line, text: block.lines.join("\n") })
    block = { line: 0, quoted: false, lines: [] }
  }
  const lines = text.split("\n")
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    let s = raw
    if (/^```/.test(s.trim())) {
      inCode = !inCode
      flush()
      continue
    }
    if (inCode) continue
    if (inComment) {
      if (s.includes("-->")) {
        s = s.slice(s.indexOf("-->") + 3)
        inComment = false
      } else continue
    }
    while (s.includes("<!--")) {
      const start = s.indexOf("<!--")
      const end = s.indexOf("-->", start)
      if (end === -1) {
        s = s.slice(0, start)
        inComment = true
        break
      }
      s = s.slice(0, start) + s.slice(end + 3)
    }
    if (!s.trim()) {
      flush()
      continue
    }
    if (/^\s*#/.test(s)) {
      flush()
      continue // headings are not prose
    }
    if (/^\s*!\[\[(figure|include):/.test(s)) {
      flush()
      continue // directives
    }
    if (TABLE_ROW.test(s)) {
      flush()
      if (!isTableSeparator(s)) {
        for (const cell of s.split("|").slice(1, -1)) {
          if (cell.trim()) segments.push({ line, text: cell })
        }
      }
      continue
    }
    const quote = /^\s*>+\s?/.exec(s)?.[0]
    if (quote !== undefined) {
      // Blockquote lines join only with adjacent blockquote lines.
      if (block.lines.length && !block.quoted) flush()
      if (!block.lines.length) block = { line, quoted: true, lines: [] }
      block.lines.push(s.slice(quote.length))
      continue
    }
    const item = LIST_ITEM.exec(s)?.[0]
    if (item !== undefined) {
      flush() // a new list item starts a new block
      block = { line, quoted: false, lines: [s.slice(item.length)] }
      continue
    }
    if (block.lines.length && block.quoted) flush()
    if (!block.lines.length) block = { line, quoted: false, lines: [] }
    block.lines.push(s)
  }
  flush()
  return segments
}

/**
 * Sentence boundaries: . ! ? followed by whitespace and a capital letter (or
 * the end of the block). Abbreviations (e.g., i.e., U.S., vs., No.) and
 * decimals/versions (digits around the point, no following space) do not end
 * a sentence.
 */
const ABBREVIATION = /^(?:e\.g|i\.e|u\.s|vs|no|nos|etc|cf|fig)\.$/i
const BOUNDARY = /[.!?]+["'”’)\]]*(?=\s|$)/g
const SENTENCE_START = /^[*_`"'“‘(\[]*[A-Z0-9]/

function sentences(segment: Segment): { line: number; sentence: string }[] {
  const { line, text } = segment
  const out: { line: number; sentence: string }[] = []
  let start = 0
  BOUNDARY.lastIndex = 0
  for (let match = BOUNDARY.exec(text); match; match = BOUNDARY.exec(text)) {
    const end = match.index + match[0].length
    const before = text.slice(0, end)
    const after = text.slice(end).trimStart()
    const tail = /([A-Za-z.]+)[^A-Za-z.]*$/.exec(before)?.[1] ?? ""
    if (ABBREVIATION.test(tail)) continue
    if (after && !SENTENCE_START.test(after)) continue
    out.push({ line: line + newlinesBetween(text, start, end), sentence: text.slice(start, end) })
    start = end
  }
  const rest = text.slice(start)
  if (rest.trim()) out.push({ line: line + newlinesBetween(text, start, text.length), sentence: rest })
  return out
}

function newlinesBetween(text: string, from: number, to: number): number {
  let count = 0
  for (let i = from; i < to; i++) if (text[i] === "\n") count++
  return count
}

/** Inline code spans count as one word each. */
function words(sentence: string): string[] {
  return sentence
    .replace(/`[^`]*`/g, " code ")
    .split(/\s+/)
    .map((token) => token.replace(/^[*_`#<>[\]()]+|[*_`<>[\]()]+$/g, ""))
    .filter((token) => /[A-Za-z0-9]/.test(token))
}

function lintSentences(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  for (const segment of proseSegments(doc.text)) {
    for (const { line, sentence } of sentences(segment)) {
      const count = words(sentence).length
      if (count > SENTENCE_WORD_LIMIT) {
        const preview = sentence.trim().split(/\s+/).slice(0, 8).join(" ")
        findings.push({
          rule: "sentence-length",
          severity: "error",
          file: doc.file,
          line,
          message: `${count} words (> ${SENTENCE_WORD_LIMIT}): "${preview}…"`,
        })
      }
    }
  }
  return findings
}

function lintPlaceholders(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  for (const [index, raw] of doc.text.split("\n").entries()) {
    for (const match of raw.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
      if (PLACEHOLDER_ALLOWLIST.has(match[1]!)) continue
      findings.push({
        rule: "unresolved-placeholder",
        severity: "error",
        file: doc.file,
        line: index + 1,
        message: `unresolved placeholder {{${match[1]}}}`,
      })
    }
  }
  return findings
}

function lintHeadings(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  const docNumber = Number(/^(\d\d)/.exec(doc.file)?.[1])
  if (Number.isNaN(docNumber)) return findings
  let inCode = false
  for (const [index, raw] of doc.text.split("\n").entries()) {
    if (/^```/.test(raw.trim())) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const match = /^(#{1,6})\s+(\d+)((?:\.\d+)*)[\s.—-]/.exec(raw)
    if (!match) continue
    if (Number(match[2]) !== docNumber) {
      findings.push({
        rule: "heading-numbering",
        severity: "error",
        file: doc.file,
        line: index + 1,
        message: `heading "${raw.trim().slice(0, 72)}" numbers under ${match[2]}… but this is document ${doc.file.slice(0, 2)}`,
      })
    }
  }
  return findings
}

function lintFigures(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  const docNumber = Number(/^(\d\d)/.exec(doc.file)?.[1])
  const lines = doc.text.split("\n")
  const directives = new Map<string, number>()
  const captions = new Map<string, number>()
  for (const [index, raw] of lines.entries()) {
    const directive = /^\s*!\[\[figure:([\w-]+)(?:\s+landscape)?\]\]\s*$/.exec(raw)
    if (directive) directives.set(directive[1]!, index + 1)
    const caption = /^\s*_\*?Figure ([\w-]+)/.exec(raw)
    if (caption) captions.set(caption[1]!, index + 1)
  }
  for (const [id, line] of directives) {
    const prefix = Number(id.split("-")[0])
    if (prefix !== docNumber) {
      findings.push({
        rule: "figure-numbering",
        severity: "error",
        file: doc.file,
        line,
        message: `figure ${id} does not belong to document ${doc.file.slice(0, 2)}`,
      })
    }
    if (!captions.has(id)) {
      findings.push({
        rule: "figure-numbering",
        severity: "error",
        file: doc.file,
        line,
        message: `figure ${id} has no caption ("_Figure ${id} — …_")`,
      })
    }
    // referenced anywhere outside directive and caption lines? Accepts both
    // "Figure 2-2a" and grouped mentions like "Figures 2-2a and 2-2b".
    const token = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    const referenced = lines.some(
      (raw, index) =>
        index + 1 !== line &&
        !/^\s*!\[\[figure:/.test(raw) &&
        !/^\s*_\*?Figure /.test(raw) &&
        (raw.includes(`Figure ${id}`) || (/\bFigures?\b/.test(raw) && token.test(raw))),
    )
    if (!referenced) {
      findings.push({
        rule: "figure-not-referenced",
        severity: "warning",
        file: doc.file,
        line,
        message: `figure ${id} is never referenced from prose`,
      })
    }
  }
  for (const [id, line] of captions) {
    if (!directives.has(id)) {
      findings.push({
        rule: "figure-numbering",
        severity: "error",
        file: doc.file,
        line,
        message: `caption for figure ${id} has no ![[figure:${id}]] directive`,
      })
    }
  }
  return findings
}

function lintBanned(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  let inCode = false
  for (const [index, raw] of doc.text.split("\n").entries()) {
    if (/^```/.test(raw.trim())) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const lower = raw.toLowerCase()
    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) {
        findings.push({
          rule: "banned-phrase",
          severity: "warning",
          file: doc.file,
          line: index + 1,
          message: `banned phrase "${phrase}"`,
        })
      }
    }
  }
  return findings
}

function lintInternalPaths(doc: LintDoc): Finding[] {
  const findings: Finding[] = []
  for (const [index, raw] of doc.text.split("\n").entries()) {
    if (/^\s*<!--/.test(raw) && /-->\s*$/.test(raw)) continue
    for (const [pattern, label] of INTERNAL_PATHS) {
      const match = pattern.exec(raw)
      if (match) {
        findings.push({
          rule: "internal-path",
          severity: "warning",
          file: doc.file,
          line: index + 1,
          message: `internal ByMorning path "${match[0]}" (${label})`,
        })
      }
    }
  }
  return findings
}

/**
 * Cross-references: every §x.y reference must name a section that exists.
 * The package renders as one document whose chapter numbers are the document
 * numbers, so §x.y resolves to section x.y of chapter x (document 0x). An
 * explicit "document NN §x.y", "`NN-slug.md` §x.y", or "NN §x.y" prefix is
 * still accepted and names document NN. Soft-wrapped lines are joined so
 * references spanning a line break still resolve; fenced code is excluded.
 */
function lintXrefs(docs: LintDoc[]): Finding[] {
  const sections = new Map<string, Set<string>>()
  for (const doc of docs) {
    const num = /^(\d\d)/.exec(doc.file)?.[1]
    if (!num) continue
    const set = sections.get(num) ?? new Set<string>()
    for (const raw of doc.text.split("\n")) {
      const match = /^#{1,6}\s+(\d+(?:\.\d+)+)\b/.exec(raw)
      if (match) set.add(match[1]!)
    }
    sections.set(num, set)
  }
  const reference = /(?:(\d{2})(?:-[\w.-]+)?`?\s*,?\s*)?§\s*(\d+(?:\.\d+)+)/g
  const findings: Finding[] = []
  for (const doc of docs) {
    const num = /^(\d\d)/.exec(doc.file)?.[1]
    if (!num) continue
    // Join the source with spaces, remembering where each source line starts.
    const chunks: string[] = []
    const starts: number[] = []
    let inCode = false
    for (const [index, raw] of doc.text.split("\n").entries()) {
      if (/^```/.test(raw.trim())) {
        inCode = !inCode
        continue
      }
      if (inCode) continue
      starts.push(chunks.join("").length)
      chunks.push(raw, " ")
    }
    const joined = chunks.join("")
    const lineAt = (offset: number): number => {
      let line = 1
      for (const [index, start] of starts.entries()) if (start <= offset) line = index + 1
      return line
    }
    for (const match of joined.matchAll(reference)) {
      const section = match[2]!
      const target = match[1] ?? section.split(".")[0]!.padStart(2, "0")
      if (!sections.get(target)?.has(section)) {
        findings.push({
          rule: "xref",
          severity: "error",
          file: doc.file,
          line: lineAt(match.index!),
          message: `§${section} does not exist in document ${target} ("${match[0].trim().slice(0, 48)}")`,
        })
      }
    }
  }
  return findings
}

export function lintDocs(docs: LintDoc[]): Finding[] {
  const findings = docs.flatMap((doc) => [
    ...lintSentences(doc),
    ...lintPlaceholders(doc),
    ...lintHeadings(doc),
    ...lintFigures(doc),
    ...lintBanned(doc),
    ...lintInternalPaths(doc),
  ])
  return [...findings, ...lintXrefs(docs)]
}

const RULE_ORDER = ["sentence-length", "unresolved-placeholder", "heading-numbering", "figure-numbering", "figure-missing", "figure-scale", "figure-not-referenced", "xref", "banned-phrase", "internal-path", "overflow"]

export function formatReport(findings: Finding[]): string {
  const out: string[] = []
  const errors = findings.filter((f) => f.severity === "error")
  const warnings = findings.filter((f) => f.severity === "warning")
  out.push(`security review lint — ${errors.length} errors, ${warnings.length} warnings`, "")
  const files = [...new Set(findings.map((f) => f.file))].sort()
  if (files.length) {
    out.push("summary (findings per document per rule):", "")
    out.push(["document".padEnd(44), ...RULE_ORDER.map((r) => r.padStart(23))].join(""))
    for (const file of files) {
      const counts = RULE_ORDER.map((rule) => findings.filter((f) => f.file === file && f.rule === rule).length)
      out.push([file.padEnd(44), ...counts.map((c) => String(c || "").padStart(23))].join(""))
    }
    out.push("")
  }
  for (const f of findings) {
    out.push(`${f.severity.padEnd(7)} ${f.rule.padEnd(22)} ${f.file}:${f.line}: ${f.message}`)
  }
  return out.join("\n")
}
