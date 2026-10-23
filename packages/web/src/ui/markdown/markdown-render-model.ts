import { createResource } from "solid-js"
import { isServer } from "solid-js/web"

import {
  checksum,
  getCachedMarkdown,
  sanitizeMarkdown,
  touchCachedMarkdown,
  type MarkdownCacheEntry,
} from "./markdown-cache"
import { canReusePendingBlock, completedProjection } from "./markdown-projection"
import type { Block, Projection } from "./markdown-stream"
import {
  disposeMarkdownProjection,
  disposeStreamingCode,
  highlightStreamingCode,
  MarkdownWorkerDisposedError,
  MarkdownWorkerSupersededError,
  MarkdownWorkerUnavailableError,
  parseMarkdown,
  projectMarkdown,
} from "./markdown-worker"
import { markdownBlockKey, type MarkdownToken } from "./markdown-worker-protocol"

export type RenderedMarkdownBlock =
  | (MarkdownCacheEntry & { readonly key: string; readonly mode: Exclude<Block["mode"], "code"> })
  | {
      readonly key: string
      readonly mode: "code"
      readonly raw: string
      readonly hash: string
      readonly language: string
      readonly complete: boolean
      readonly generation: number
      readonly stable: MarkdownToken[]
      readonly unstable: MarkdownToken[]
    }

type RenderResult = { readonly text: string; readonly blocks: ReadonlyArray<RenderedMarkdownBlock> }

export function createMarkdownRenderModel(
  input: { readonly text: string; readonly cacheKey?: string; readonly streaming?: boolean },
  owner: string,
) {
  const activeCode = new Set<string>()
  const completedCode = new Map<string, Extract<RenderedMarkdownBlock, { mode: "code" }>>()
  let streamed = false
  const [projection] = createResource(
    () => {
      if (isServer) return undefined
      if ((input.streaming ?? false) && input.text.length > 4_096) return undefined
      const live = input.streaming ?? false
      if (live) streamed = true
      if (!live && !streamed) return undefined
      return { key: owner, text: input.text, live }
    },
    // A failed worker (for example, its script could not load) falls back to the raw text instead
    // of erroring the resource, which would take the whole page into its error boundary.
    async (source): Promise<Projection> => {
      try {
        return await projectMarkdown(source.key, source.text, source.live)
      } catch {
        return { text: source.text, blocks: [{ raw: source.text, src: source.text, mode: "live" }] }
      }
    },
    { initialValue: { text: "", blocks: [] } satisfies Projection },
  )
  const currentProjection = () => {
    if (!(input.streaming ?? false) && !streamed) return completedProjection(input.text)
    const value = projection.latest
    if (value?.text && input.text.startsWith(value.text)) return value
    return { text: input.text, blocks: input.text ? [{ raw: input.text, src: input.text, mode: "live" as const }] : [] }
  }
  const [result] = createResource(
    () => {
      if ((input.streaming ?? false) && input.text.length > 4_096) return undefined
      const value = !(input.streaming ?? false) && !streamed ? completedProjection(input.text) : projection.latest
      if (!value || value.text !== input.text) return undefined
      return { text: input.text, key: input.cacheKey, projection: value }
    },
    async (source): Promise<RenderResult> => {
      if (!source.text) return { text: source.text, blocks: [] }
      const base = source.key ?? checksum(source.text)
      try {
        const blocks = await Promise.all(
          source.projection.blocks.map(async (block, index): Promise<RenderedMarkdownBlock> => {
            const cacheKey = `${base}:${index}:${block.mode}`
            const blockKey = markdownBlockKey(owner, source.key, index, block.mode)
            if (block.mode === "code") {
              const cached = completedCode.get(blockKey)
              if (block.complete && cached?.raw === block.raw) return cached
              const tokens = await highlight(block.src, block.language, blockKey, !!block.complete)
              const rendered = {
                key: blockKey,
                mode: "code" as const,
                raw: block.raw,
                hash: String(block.raw.length),
                complete: !!block.complete,
                ...tokens,
              }
              if (block.complete) completedCode.set(blockKey, rendered)
              return rendered
            }
            const cached = getCachedMarkdown(cacheKey)
            if (cached?.raw === block.raw) {
              touchCachedMarkdown(cacheKey, cached)
              return { key: blockKey, mode: block.mode, ...cached }
            }
            const entry = {
              raw: block.raw,
              hash: checksum(block.raw),
              html: sanitizeMarkdown(await parseMarkdown(block.src)),
            }
            touchCachedMarkdown(cacheKey, entry)
            return { key: blockKey, mode: block.mode, ...entry }
          }),
        )
        return { text: source.text, blocks }
      } catch {
        return {
          text: source.text,
          blocks: [
            { key: base, mode: "full", raw: source.text, hash: checksum(source.text), html: fallback(source.text) },
          ],
        }
      }
    },
    { initialValue: initialResult(input.text, input.cacheKey, input.streaming ?? false, owner) },
  )

  return {
    blocks() {
      if ((input.streaming ?? false) && input.text.length > 4_096) {
        const base = input.cacheKey ?? checksum(input.text)
        return [{ key: base, mode: "live" as const, raw: input.text, hash: String(input.text.length), html: fallback(input.text) }]
      }
      const rendered = result.latest ?? result()
      if (input.text && !(input.streaming ?? false) && !streamed && rendered.text !== input.text) return rendered.blocks
      return pendingBlocks(rendered, currentProjection(), input.cacheKey, owner)
    },
    ready: () =>
      ((input.streaming ?? false) && input.text.length > 4_096) ||
      (!result.loading && (result.latest ?? result()).text === input.text),
    activate(blocks: ReadonlyArray<RenderedMarkdownBlock>) {
      const nextCode = new Set(blocks.filter((block) => block.mode === "code").map((block) => block.key))
      activeCode.forEach((key) => {
        if (!nextCode.has(key)) disposeStreamingCode(key)
      })
      activeCode.clear()
      nextCode.forEach((key) => activeCode.add(key))
    },
    dispose() {
      disposeMarkdownProjection(owner)
      activeCode.forEach(disposeStreamingCode)
      completedCode.clear()
    },
  }
}

async function highlight(text: string, language: string | undefined, key: string, complete: boolean) {
  try {
    return await highlightStreamingCode(key, text, language ?? "text", complete)
  } catch (error) {
    if (
      !(error instanceof MarkdownWorkerDisposedError) &&
      !(error instanceof MarkdownWorkerSupersededError) &&
      !(error instanceof MarkdownWorkerUnavailableError)
    )
      console.error("Markdown highlighting failed", error)
    return { language: language ?? "text", generation: 0, stable: [], unstable: [[text, ""] as MarkdownToken] }
  }
}

function initialResult(text: string, cacheKey: string | undefined, streaming: boolean, owner: string): RenderResult {
  if (!text) return { text, blocks: [] }
  const base = cacheKey ?? checksum(text)
  const cached = getCachedMarkdown(`${base}:0:full`)
  if (cached?.raw === text)
    return { text, blocks: [{ key: markdownBlockKey(owner, cacheKey, 0, "full"), mode: "full", ...cached }] }
  if (!streaming) return { text: "", blocks: [] }
  return { text, blocks: [{ key: "initial", mode: "full", raw: text, hash: checksum(text), html: fallback(text) }] }
}

function pendingBlocks(result: RenderResult, projection: Projection, cacheKey: string | undefined, owner: string) {
  if (result.text === projection.text) return result.blocks
  const initial = result.blocks.length === 1 && result.blocks[0]?.key === "initial"
  return projection.blocks.map((block, index): RenderedMarkdownBlock => {
    const current = initial ? undefined : result.blocks[index]
    if (current && canReusePendingBlock(current, block)) return current
    const key = markdownBlockKey(owner, cacheKey, index, block.mode)
    if (block.mode !== "code")
      return { key, mode: block.mode, raw: block.raw, hash: String(block.raw.length), html: fallback(block.src) }
    return {
      key,
      mode: "code",
      raw: block.raw,
      hash: String(block.raw.length),
      language: block.language ?? "text",
      complete: !!block.complete,
      stable: [],
      unstable: [[block.src, ""]],
      generation: 0,
    }
  })
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
const fallback = (text: string) => escape(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
