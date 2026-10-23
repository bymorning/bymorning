import { createEffect, onCleanup, type JSX } from "solid-js"

import { PacedMarkdown } from "./paced-markdown"
import { decorateFileLinks } from "./file-link/dom"

export { fileMatches } from "./file-link/matcher"

export function FileLink(props: {
  readonly text: string
  readonly cacheKey: string
  readonly streaming: boolean
  readonly paths: ReadonlyArray<string>
  readonly onOpen: (path: string) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  let root!: HTMLDivElement
  const adapter = () => decorateFileLinks(root, props.paths, props.onOpen)
  let links: ReturnType<typeof adapter> | undefined
  let observer: MutationObserver | undefined
  createEffect(() => {
    props.text
    props.paths
    if (!root) return
    // A streamed token can still become part of a longer path. Do not make a
    // prefix look complete before the Message part has settled.
    if (props.streaming) return
    links ??= adapter()
    observer ??= new MutationObserver(() => links?.update())
    observer.observe(root, { childList: true, subtree: true })
    // Markdown owns its sanitized DOM. Decorate after its imperative update, never before it.
    queueMicrotask(() => links?.update())
  })
  onCleanup(() => {
    observer?.disconnect()
    links?.dispose()
  })
  return (
    <div ref={(element) => (root = element)} data-component="file-link">
      <PacedMarkdown
        text={props.text}
        cacheKey={props.cacheKey}
        streaming={props.streaming}
        onContentRendered={() => {
          if (!props.streaming) links?.update()
          props.onContentRendered?.()
        }}
      />
    </div>
  )
}
