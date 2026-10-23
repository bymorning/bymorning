const LABEL = /^(?:session\s+|conversation\s+)?title\s*[:：-]\s*/i
const BOLD_LABEL = /^(\*\*|__)(?:session\s+|conversation\s+)?title\s*[:：-]?\s*\1\s*[:：-]?\s*/i
const WRAPPERS = /^(?:#{1,6}\s+|>\s+|[-*+]\s+)/
const PAIRS = [
  ["**", "**"],
  ["__", "__"],
  ["*", "*"],
  ["_", "_"],
  ["`", "`"],
  ['"', '"'],
  ["'", "'"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
] as const

const FENCE = /^(?:`{3,}|~{3,})/
const INLINE = [
  /(?<![\w*])(\*\*)(?=\S)(.+?)(?<=\S)\1(?![\w*])/g,
  /(?<![\w_])(__)(?=\S)(.+?)(?<=\S)\1(?![\w_])/g,
  /(?<![\w*])(\*)(?=\S)([^*]+?)(?<=\S)\1(?![\w*])/g,
  /(`+)([^`]+?)\1/g,
] as const

const stripInline = (value: string) => INLINE.reduce((text, pattern) => text.replace(pattern, "$2"), value)

/** First non-empty line that is not a code fence or inside a fenced block. */
const firstLine = (raw: string) => {
  let fence: string | undefined
  for (const line of raw.split("\n").map((item) => item.trim())) {
    const marker = FENCE.exec(line)?.[0]
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    if (line.length > 0) return line
  }
  return undefined
}

const unwrap = (value: string) => {
  for (const [open, close] of PAIRS) {
    if (value.length >= open.length + close.length && value.startsWith(open) && value.endsWith(close))
      return value.slice(open.length, value.length - close.length).trim()
  }
  return value
}

const TRAILING = /[\s.:;,!\-]+$/
/** Wrapper, label and quote removal can expose one another (`# **Title: x**`); a few passes settle any real input. */
const MAX_PASSES = 4
const MAX_WORDS = 8
/** Only the first line matters, so bound the input before splitting a pasted multi-megabyte message. */
const MAX_INPUT = 2_048

/**
 * Normalizes raw model output into a plain one-line Session title: removes heading and list
 * markers, a leading "Title:" label, surrounding emphasis or quotes, and trailing punctuation.
 * Returns undefined when nothing usable remains.
 */
export const sanitizeTitle = (raw: string): string | undefined => {
  const first = firstLine(raw)
  if (first === undefined) return undefined
  let value = first
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = value
    value = value.replace(WRAPPERS, "").replace(BOLD_LABEL, "").replace(LABEL, "").trim()
    value = unwrap(value)
    if (value === before) break
  }
  value = stripInline(value).replace(TRAILING, "").trim()
  return value.length === 0 ? undefined : value
}

/**
 * Fallback title derived from the user's own message: first non-empty line outside code fences,
 * markdown stripped, whitespace collapsed, limited to a few words. Undefined when nothing remains.
 */
export const fallbackTitle = (text: string): string | undefined => {
  const clean = sanitizeTitle(text.slice(0, MAX_INPUT))
  if (clean === undefined) return undefined
  const title = clean.split(/\s+/).slice(0, MAX_WORDS).join(" ").replace(TRAILING, "")
  return title.length === 0 ? undefined : title
}
