import { marked, type Token, type Tokens } from "marked"
import remend from "remend"

import { completedProjection } from "./markdown-projection"

export type Block = {
  readonly raw: string
  readonly src: string
  readonly mode: "full" | "live" | "code"
  readonly language?: string
  readonly complete?: boolean
}

export type Projection = { readonly text: string; readonly blocks: ReadonlyArray<Block> }

const hasReferences = (text: string) =>
  text.includes("]:") && /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?:\S+|\r?\n[ \t]+\S+)/m.test(text)

const language = (value: string | undefined) => value?.trim().split(/\s+/, 1)[0] || undefined
const codeBlock = (raw: string, src: string, value: string | undefined, complete?: true): Block => {
  const name = language(value)
  return { raw, src, mode: "code", ...(name ? { language: name } : {}), ...(complete ? { complete } : {}) }
}
const codeBody = (raw: string) => {
  const newline = raw.indexOf("\n")
  return newline < 0 ? "" : raw.slice(newline + 1)
}
const fenceOpen = (raw: string) => {
  const mark = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)?.[1]
  if (!mark) return false
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${mark[0]}{${mark.length},}[\\t ]*$`).test(last)
}
const closesFence = (raw: string, suffix: string) => {
  const mark = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)?.[1]
  if (!mark) return suffix.includes("```") || suffix.includes("~~~")
  return `${raw.slice(-(mark.length - 1))}${suffix}`.includes(mark)
}
const heal = (text: string) => remend(text, { linkMode: "text-only" })
const isCode = (token: Token): token is Tokens.Code => token.type === "code" && "text" in token

export function stream(text: string, live: boolean): ReadonlyArray<Block> {
  if (!live) return completedProjection(text).blocks
  if (hasReferences(text)) return [{ raw: text, src: heal(text), mode: "live" }]
  const tokens = marked.lexer(text)
  let tail = -1
  for (let index = tokens.length - 1; index >= 0; index--) {
    if (tokens[index]?.type !== "space") {
      tail = index
      break
    }
  }
  if (tail < 0) return [{ raw: text, src: heal(text), mode: "live" }]
  const last = tokens[tail]
  if (!last) return [{ raw: text, src: heal(text), mode: "live" }]

  const result: Array<Block> = []
  for (let index = 0; index < tail; index++) {
    const token = tokens[index]
    if (!token || token.type === "space") continue
    let raw = token.raw
    while (tokens[index + 1]?.type === "space" && index + 1 < tail) raw += tokens[++index]!.raw
    if (isCode(token)) {
      result.push(codeBlock(raw, token.text, token.lang, true))
    } else result.push({ raw, src: raw, mode: "full" })
  }

  const raw = tokens
    .slice(tail)
    .map((token: Token) => token.raw)
    .join("")
  if (!isCode(last)) return [...result, { raw, src: heal(raw), mode: "live" }]
  if (!fenceOpen(last.raw)) return [...result, codeBlock(raw, last.text, last.lang, true)]
  return [...result, codeBlock(raw, codeBody(last.raw), last.lang)]
}

export function project(previous: Projection | undefined, text: string, live: boolean): Projection {
  if (!live) {
    const current =
      previous?.text === text
        ? previous
        : previous && text.startsWith(previous.text)
          ? project(previous, text, true)
          : undefined
    if (!current) return completedProjection(text)
    return {
      text,
      blocks: current.blocks.map((block) => {
        if (block.mode === "live") return { raw: block.raw, src: block.raw, mode: "full" }
        if (block.mode === "code" && !block.complete) return { ...block, complete: true }
        return block
      }),
    }
  }
  if (!previous || !text.startsWith(previous.text)) return { text, blocks: stream(text, live) }
  const tail = previous.blocks.at(-1)
  const suffix = text.slice(previous.text.length)
  if (!suffix || tail?.mode !== "code" || tail.complete || closesFence(tail.raw, suffix))
    return { text, blocks: stream(text, live) }
  return {
    text,
    blocks: [...previous.blocks.slice(0, -1), { ...tail, raw: tail.raw + suffix, src: tail.src + suffix }],
  }
}
