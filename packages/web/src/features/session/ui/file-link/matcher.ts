export interface FileMatch {
  readonly start: number
  readonly end: number
  readonly path: string
}

/** Finds only exact, Project-relative file names.  This deliberately has no basename fallback. */
export function fileMatches(text: string, paths: ReadonlyArray<string>, mode: "user" | "markdown") {
  const matches: FileMatch[] = []
  const candidates = [...new Set(paths)].sort((left, right) => right.length - left.length)
  for (const path of candidates) {
    let start = text.indexOf(path)
    while (start !== -1) {
      const end = start + path.length
      const before = text[start - 1]
      const after = text[end]
      const delimited = (!before || /[\s([{'"`]/u.test(before)) && (!after || /[\s).,;:!?\]}'"`]/u.test(after))
      const userReference = start > 0 && text[start - 1] === "@"
      if (
        (mode === "user" ? userReference : delimited) &&
        !matches.some((match) => start < match.end && end > match.start)
      )
        matches.push({ start, end, path })
      start = text.indexOf(path, start + path.length)
    }
  }
  return matches.sort((left, right) => left.start - right.start)
}
