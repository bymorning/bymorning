import morphdom from "morphdom"

const copyToClipboard = (value: string): Promise<"copied" | "unavailable" | "failed"> => {
  if (!navigator.clipboard) return Promise.resolve("unavailable")
  return navigator.clipboard.writeText(value).then(
    () => "copied" as const,
    () => "failed" as const,
  )
}
import { checksum } from "./markdown-cache"
import { shouldResetCodeTokens, type RenderedCodeState } from "./markdown-code-state"
import { renderMermaidSvg } from "./markdown-mermaid"
import type { RenderedMarkdownBlock } from "./markdown-render-model"
import type { MarkdownToken } from "./markdown-worker-protocol"

const renderedCode = new WeakMap<HTMLDivElement, RenderedCodeState>()
type CopyLabels = {
  readonly copy: string
  readonly copied: string
  readonly copyCode: string
  readonly codeCopied: string
}

export function createMarkdownDomAdapter(container: HTMLDivElement, labels: () => CopyLabels) {
  let copyCleanup: (() => void) | undefined
  return {
    update(blocks: ReadonlyArray<RenderedMarkdownBlock>) {
      blocks.forEach((block, index) => updateBlock(container, index, block, labels))
      while (container.children.length > blocks.length) container.lastElementChild?.remove()
      syncCopyLabels(container, labels)
      copyCleanup ??= setupCopy(container, labels)
    },
    dispose() {
      copyCleanup?.()
    },
  }
}

function updateBlock(container: HTMLDivElement, index: number, block: RenderedMarkdownBlock, labels: () => CopyLabels) {
  const current = container.children[index]
  if (block.mode === "code") return updateCodeBlock(container, current, block, labels)
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
  decorateCode(next, labels)
  if (!(current instanceof HTMLDivElement)) {
    container.appendChild(next)
    decorateMermaidBlocks(next)
    return
  }
  morphdom(current, next, { onBeforeElUpdated: (from, to) => !from.isEqualNode(to) })
  decorateMermaidBlocks(current)
}

function updateCodeBlock(
  container: HTMLDivElement,
  current: Element | undefined,
  block: Extract<RenderedMarkdownBlock, { mode: "code" }>,
  labels: () => CopyLabels,
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
    wrapper.append(pre, copyButton(labels))
    next.appendChild(wrapper)
  }
  code.className = `language-${block.language}`
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
      wrapper.removeAttribute("data-mermaid-pending")
      wrapper.setAttribute("data-mermaid-ready", "true")
    })
    .catch(() => {
      if (!complete || code.textContent !== source) return
      clearMermaid(wrapper)
    })
}

function clearMermaid(wrapper: Element) {
  wrapper.removeAttribute("data-mermaid-attempt")
  wrapper.removeAttribute("data-mermaid-pending")
  wrapper.removeAttribute("data-mermaid-ready")
  wrapper.querySelector('[data-component="markdown-mermaid"]')?.remove()
}

function decorateCode(root: HTMLElement, labels: () => CopyLabels) {
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement?.dataset.component === "markdown-code") return
    const wrapper = document.createElement("div")
    wrapper.dataset.component = "markdown-code"
    pre.replaceWith(wrapper)
    wrapper.append(pre, copyButton(labels))
  })
}

function decorateMermaidBlocks(root: HTMLElement) {
  root.querySelectorAll('[data-component="markdown-code"]').forEach((wrapper) => {
    const code = wrapper.querySelector("code")
    if (code instanceof HTMLElement) decorateMermaid(wrapper, code, true)
  })
}

function copyButton(labels: () => CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.slot = "markdown-copy-button"
  button.setAttribute("aria-label", labels().copyCode)
  button.textContent = labels().copy
  return button
}

function syncCopyLabels(root: HTMLElement, labels: () => CopyLabels) {
  root.querySelectorAll<HTMLButtonElement>('[data-slot="markdown-copy-button"]').forEach((button) => {
    const copied = button.dataset.copied === "true"
    button.textContent = copied ? labels().copied : labels().copy
    button.setAttribute("aria-label", copied ? labels().codeCopied : labels().copyCode)
  })
}

function setupCopy(root: HTMLElement, labels: () => CopyLabels) {
  const resets = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
  const click = async (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-slot="markdown-copy-button"]') : null
    if (!(target instanceof HTMLButtonElement)) return
    const text = target.closest('[data-component="markdown-code"]')?.querySelector("code")?.textContent
    if (!text) return
    if ((await copyToClipboard(text)) !== "copied") return
    target.dataset.copied = "true"
    target.textContent = labels().copied
    target.setAttribute("aria-label", labels().codeCopied)
    const pending = resets.get(target)
    if (pending) clearTimeout(pending)
    resets.set(
      target,
      setTimeout(() => {
        target.removeAttribute("data-copied")
        target.textContent = labels().copy
        target.setAttribute("aria-label", labels().copyCode)
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
