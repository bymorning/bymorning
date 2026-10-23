import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"

import { Markdown } from "../../../ui/components/markdown"

const pace = 24
const immediate = 512
const maximumBacklog = 2_048
const snap = /[\s.,!?;:)\]]/
const step = (size: number) => (size <= 12 ? 2 : size <= 48 ? 4 : size <= 96 ? 8 : Math.min(256, Math.ceil(size / 4)))
const next = (text: string, start: number) => {
  const end = Math.min(text.length, start + step(text.length - start))
  const maximum = Math.min(text.length, end + 8)
  for (let index = end; index < maximum; index++) if (snap.test(text[index] ?? "")) return index + 1
  return end
}

export function createPacedValue(value: () => string, live: () => boolean) {
  const [rendered, setRendered] = createSignal(value())
  let shown = value()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timeout) clearTimeout(timeout)
    timeout = undefined
  }
  const sync = (text: string) => {
    shown = text
    setRendered(text)
  }
  const run = () => {
    timeout = undefined
    const text = value()
    if (
      !live() ||
      !text.startsWith(shown) ||
      text.length <= shown.length ||
      text.length - shown.length <= immediate ||
      text.length - shown.length > maximumBacklog
    ) {
      sync(text)
      return
    }
    const end = next(text, shown.length)
    sync(text.slice(0, end))
    if (end < text.length) timeout = setTimeout(run, pace)
  }
  createEffect(() => {
    const text = value()
    if (
      !live() ||
      !text.startsWith(shown) ||
      text.length < shown.length ||
      text.length - shown.length <= immediate ||
      text.length - shown.length > maximumBacklog
    ) {
      clear()
      sync(text)
      return
    }
    if (text.length !== shown.length && !timeout) timeout = setTimeout(run, pace)
  })
  onCleanup(clear)
  return rendered
}

export function PacedMarkdown(props: {
  readonly text: string
  readonly cacheKey: string
  readonly streaming: boolean
  readonly renderMarkdown?: boolean
  readonly onContentRendered?: () => void
}) {
  const text = createPacedValue(
    () => props.text,
    () => props.streaming,
  )
  return (
    <Show when={text()}>
      <Show
        when={props.renderMarkdown !== false}
        fallback={
          <RawText
            text={text()}
            {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
          />
        }
      >
        <Markdown
          text={text()}
          cacheKey={props.cacheKey}
          streaming={props.streaming}
          {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
        />
      </Show>
    </Show>
  )
}

function RawText(props: { readonly text: string; readonly onContentRendered?: () => void }) {
  createEffect(
    on(
      () => props.text,
      () => props.onContentRendered?.(),
    ),
  )
  return (
    <pre data-component="raw-text" dir="auto">
      {props.text}
    </pre>
  )
}
