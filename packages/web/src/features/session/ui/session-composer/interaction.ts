export interface KeyInput {
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly defaultPrevented: boolean
  readonly isComposing: boolean
}

export interface ReferenceMention {
  readonly query: string
  readonly start: number
  readonly end: number
}

export function referenceMention(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ReferenceMention | undefined {
  if (selectionStart !== selectionEnd) return undefined
  const at = Array.from(value.slice(0, selectionStart).matchAll(/@/g))
    .map((match) => match.index)
    .findLast((index) => index === 0 || /[\s([{'"<]/u.test(value[index - 1]!))
  if (at === undefined) return undefined
  const quoted = value[at + 1] === '"'
  const query = value.slice(at + (quoted ? 2 : 1), selectionStart)
  if ((!quoted && /\s/.test(query)) || (quoted && /(^|[^\\])"/.test(query))) return undefined
  return { query, start: at, end: selectionStart }
}

export function submit(input: KeyInput): boolean {
  return !input.defaultPrevented && !input.isComposing && input.key === "Enter" && !input.shiftKey
}

export function stop(input: KeyInput, command: "submit" | "stop" | undefined): boolean {
  if (input.defaultPrevented || command !== "stop") return false
  return input.key === "Escape" || (input.ctrlKey && !input.shiftKey && input.key.toLowerCase() === "g")
}
