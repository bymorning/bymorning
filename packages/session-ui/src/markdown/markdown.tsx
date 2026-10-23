import { createEffect, createSignal, createUniqueId, onCleanup, splitProps, untrack } from "solid-js"
import { isServer } from "solid-js/web"

import { createMarkdownDomAdapter } from "./markdown-dom-adapter"
import { createMarkdownRenderModel } from "./markdown-render-model"
import { useSession } from "../context/session"
import "./markdown.css"

export function Markdown(props: {
  readonly text: string
  readonly cacheKey?: string
  readonly streaming?: boolean
  readonly class?: string
  readonly onContentRendered?: () => void
}) {
  const session = useSession()
  const [local] = splitProps(props, ["text", "cacheKey", "streaming", "class", "onContentRendered"])
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const model = createMarkdownRenderModel(local, createUniqueId())
  let adapter: ReturnType<typeof createMarkdownDomAdapter> | undefined

  createEffect((contentReady) => {
    const container = root()
    const blocks = model.blocks()
    if (!container || isServer) return false
    model.activate(blocks)
    adapter ??= createMarkdownDomAdapter(container, () => ({
      copy: session.labels().copy,
      copied: session.labels().toolCopied,
      copyCode: session.labels().copyCode,
      codeCopied: session.labels().codeCopied,
    }))
    adapter.update(blocks)
    const nextReady = model.ready()
    if (nextReady && !contentReady) untrack(() => local.onContentRendered?.())
    return nextReady
  }, false)

  onCleanup(() => {
    adapter?.dispose()
    model.dispose()
  })

  return (
    <div
      data-component="markdown"
      data-markdown-ready={model.ready() ? "" : undefined}
      dir="auto"
      class={local.class}
      ref={setRoot}
    />
  )
}
