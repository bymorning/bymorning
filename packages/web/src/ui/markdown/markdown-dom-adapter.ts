import morphdom from "morphdom"

import { copyToClipboard } from "../clipboard"
import { checksum } from "./markdown-cache"
import { shouldResetCodeTokens, type RenderedCodeState } from "./markdown-code-state"
import { renderMermaidSvg } from "./markdown-mermaid"
import type { RenderedMarkdownBlock } from "./markdown-render-model"
import type { MarkdownToken } from "./markdown-worker-protocol"

const renderedCode = new WeakMap<HTMLDivElement, RenderedCodeState>()

export function createMarkdownDomAdapter(container: HTMLDivElement) {
  let copyCleanup: (() => void) | undefined
  return {
    update(blocks: ReadonlyArray<RenderedMarkdownBlock>) {
      blocks.forEach((block, index) => updateBlock(container, index, block))
      while (container.children.length > blocks.length) container.lastElementChild?.remove()
      copyCleanup ??= setupCopy(container)
    },
    dispose() {
      copyCleanup?.()
    },
  }
}

function updateBlock(container: HTMLDivElement, index: number, block: RenderedMarkdownBlock) {
  const current = container.children[index]
  if (block.mode === "code") return updateCodeBlock(container, current, block)
  if (
    current instanceof HTMLDivElement &&
    current.dataset.markdownKey === block.key &&
    current.dataset.markdownHash === block.hash
  )
    return
  const next = document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.style.display = "contents"
  next.innerHTML = block.html.trimEnd()
  decorateCode(next)
  if (!(current instanceof HTMLDivElement)) {
    container.appendChild(next)
    decorateMermaidBlocks(next)
    return
  }
  morphdom(current, next, {
    onBeforeElUpdated: (from, to) => !from.matches(copyButtonSelector) && !from.isEqualNode(to),
  })
  decorateMermaidBlocks(current)
}

function updateCodeBlock(
  container: HTMLDivElement,
  current: Element | undefined,
  block: Extract<RenderedMarkdownBlock, { mode: "code" }>,
) {
  const existing = current instanceof HTMLDivElement && current.dataset.markdownKey === block.key ? current : undefined
  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.dataset.markdownComplete = String(block.complete)
  next.style.display = "contents"
  const currentCode = next.querySelector("code")
  const code = currentCode instanceof HTMLElement ? currentCode : document.createElement("code")
  if (!(currentCode instanceof HTMLElement)) {
    const wrapper = document.createElement("div")
    wrapper.dataset.component = "markdown-code"
    const pre = document.createElement("pre")
    pre.className = "shiki ByMorning"
    pre.appendChild(code)
    wrapper.append(pre, copyButton())
    next.appendChild(wrapper)
  }
  code.className = `language-${block.language}`
  const owner = code.closest('[data-component="markdown-code"]')
  if (owner instanceof HTMLElement) labelCode(owner, code)
  const previous = renderedCode.get(next)
  const reset = shouldResetCodeTokens(previous, {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    raw: block.raw,
  })
  const stableCount = reset ? 0 : previous!.stableCount
  const tail = [...block.stable.slice(stableCount), ...block.unstable]
  const prior = reset ? [] : previous!.unstable
  const changed = prior.findIndex((token, index) => !sameToken(token, tail[index]))
  const keep = stableCount + (changed < 0 ? Math.min(prior.length, tail.length) : changed)
  while (code.children.length > keep) code.lastElementChild?.remove()
  tail
    .slice(keep - stableCount)
    .map(tokenSpan)
    .forEach((span) => code.appendChild(span))
  renderedCode.set(next, {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    unstable: block.unstable,
    raw: block.raw,
  })
  const wrapper = code.closest('[data-component="markdown-code"]')
  if (wrapper) decorateMermaid(wrapper, code, block.complete)
  if (!existing) {
    if (current) {
      current.replaceWith(next)
      return
    }
    container.appendChild(next)
  }
}

function decorateMermaid(wrapper: Element, code: HTMLElement, complete: boolean) {
  if (!code.classList.contains("language-mermaid")) {
    clearMermaid(wrapper)
    return
  }
  const source = code.textContent ?? ""
  if (!source) return
  const input = complete ? source : source.slice(0, source.lastIndexOf("\n") + 1)
  if (!input) return
  const attempt = `${complete ? "complete" : "streaming"}:${checksum(input)}`
  if (wrapper.getAttribute("data-mermaid-attempt") === attempt) return
  wrapper.setAttribute("data-mermaid-attempt", attempt)
  wrapper.setAttribute("data-mermaid-pending", "true")
  const diagram = wrapper.querySelector('[data-component="markdown-mermaid"]') ?? document.createElement("div")
  diagram.setAttribute("data-component", "markdown-mermaid")
  if (!diagram.parentElement) wrapper.appendChild(diagram)
  void renderMermaidSvg(input)
    .then((svg) => {
      if (wrapper.getAttribute("data-mermaid-attempt") !== attempt) return
      if (!svg) {
        if (complete) clearMermaid(wrapper)
        return
      }
      diagram.innerHTML = svg
      limitMermaidScale(diagram)
      wrapper.removeAttribute("data-mermaid-pending")
      wrapper.setAttribute("data-mermaid-ready", "true")
    })
    .catch(() => {
      if (!complete || code.textContent !== source) return
      clearMermaid(wrapper)
    })
}

/** Below this fraction of its natural width a diagram's labels stop being legible; scroll instead. */
export const mermaidMinScale = 0.65

export function limitMermaidScale(diagram: Element) {
  const svg = diagram.querySelector("svg")
  const natural = Number(
    svg
      ?.getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)[2],
  )
  if (!svg || !Number.isFinite(natural) || natural <= 0) return
  svg.style.minWidth = `${Math.round(natural * mermaidMinScale)}px`
}

function clearMermaid(wrapper: Element) {
  wrapper.removeAttribute("data-mermaid-attempt")
  wrapper.removeAttribute("data-mermaid-pending")
  wrapper.removeAttribute("data-mermaid-ready")
  wrapper.querySelector('[data-component="markdown-mermaid"]')?.remove()
}

function decorateCode(root: HTMLElement) {
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement?.dataset.component === "markdown-code") return
    const wrapper = document.createElement("div")
    wrapper.dataset.component = "markdown-code"
    pre.replaceWith(wrapper)
    wrapper.append(pre, copyButton())
    const code = pre.querySelector("code")
    if (code instanceof HTMLElement) labelCode(wrapper, code)
  })
}

function decorateMermaidBlocks(root: HTMLElement) {
  root.querySelectorAll('[data-component="markdown-code"]').forEach((wrapper) => {
    const code = wrapper.querySelector("code")
    if (code instanceof HTMLElement) decorateMermaid(wrapper, code, true)
  })
}

const copyButtonSelector = '[data-slot="markdown-copy-button"]'

function labelCode(wrapper: HTMLElement, code: HTMLElement) {
  const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? ""
  const label = language === "text" || language === "mermaid" ? "" : language
  if (wrapper.dataset.language !== label) wrapper.dataset.language = label
}

function copyButton() {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.slot = "markdown-copy-button"
  button.setAttribute("aria-label", "Copy code")
  button.textContent = "Copy"
  return button
}

function setupCopy(root: HTMLElement) {
  const resets = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
  const click = async (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-slot="markdown-copy-button"]') : null
    if (!(target instanceof HTMLButtonElement)) return
    const text = target.closest('[data-component="markdown-code"]')?.querySelector("code")?.textContent
    if (!text) return
    if ((await copyToClipboard(text)) !== "copied") return
    target.textContent = "Copied"
    target.setAttribute("aria-label", "Code copied")
    const pending = resets.get(target)
    if (pending) clearTimeout(pending)
    resets.set(
      target,
      setTimeout(() => {
        target.textContent = "Copy"
        target.setAttribute("aria-label", "Copy code")
        resets.delete(target)
      }, 2000),
    )
  }
  root.addEventListener("click", click)
  return () => {
    root.removeEventListener("click", click)
    resets.forEach(clearTimeout)
    resets.clear()
  }
}

const sameToken = (left: MarkdownToken, right: MarkdownToken | undefined) =>
  !!right && left[0] === right[0] && left[1] === right[1]
const tokenSpan = (token: MarkdownToken) => {
  const span = document.createElement("span")
  span.setAttribute("style", token[1])
  span.textContent = token[0]
  return span
}
