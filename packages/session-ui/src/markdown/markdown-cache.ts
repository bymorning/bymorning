import DOMPurify from "dompurify"

import { parseMarkdown } from "./markdown-worker"

export type MarkdownCacheEntry = { readonly raw: string; readonly hash: string; readonly html: string }
const cache = new Map<string, MarkdownCacheEntry>()
const maximum = 200
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement) || node.target !== "_blank") return
    const rel = new Set((node.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean))
    rel.add("noopener")
    rel.add("noreferrer")
    node.setAttribute("rel", [...rel].join(" "))
  })
}

export const sanitizeMarkdown = (html: string) => (DOMPurify.isSupported ? DOMPurify.sanitize(html, config) : "")
export const getCachedMarkdown = (key: string) => cache.get(key)
export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size <= maximum) return
  const first = cache.keys().next().value
  if (first) cache.delete(first)
}

export async function preloadMarkdown(text: string, cacheKey: string) {
  const key = `${cacheKey}:0:full`
  const cached = getCachedMarkdown(key)
  if (cached?.raw === text) return touchCachedMarkdown(key, cached)
  touchCachedMarkdown(key, { raw: text, hash: checksum(text), html: sanitizeMarkdown(await parseMarkdown(text)) })
}

export function checksum(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}
