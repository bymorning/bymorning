import { createEffect, createResource, createSignal, createUniqueId, For, Match, onCleanup, Show, Switch } from "solid-js"

import {
  disposeStreamingCode,
  highlightStreamingCode,
  MarkdownWorkerDisposedError,
  MarkdownWorkerSupersededError,
  MarkdownWorkerUnavailableError,
} from "../markdown/markdown-worker"
import type { MarkdownToken } from "../markdown/markdown-worker-protocol"
import { Markdown } from "./markdown"
import "./file-viewer.css"

export type FileViewerFile =
  | {
      readonly kind: "markdown"
      readonly path: string
      readonly source: string
    }
  | {
      readonly kind: "html"
      readonly path: string
      readonly source: string
    }
  | {
      readonly kind: "code"
      readonly path: string
      readonly source: string
      readonly language: string
    }
  | {
      readonly kind: "image"
      readonly path: string
      readonly mimeType: string
      readonly data: Blob
    }
  | {
      readonly kind: "unsupported"
      readonly path: string
    }

export interface FileViewerProps {
  readonly file: FileViewerFile
  readonly class?: string
}

export function FileViewer(props: FileViewerProps) {
  return (
    <div data-component="file-viewer" class={props.class}>
      <Switch>
        <Match when={props.file.kind === "markdown" ? props.file : undefined}>
          {(file) => <Markdown text={file().source} cacheKey={`project-file:${file().path}`} />}
        </Match>
        <Match when={props.file.kind === "html" ? props.file : undefined}>
          {(file) => <HtmlPreview path={file().path} source={file().source} />}
        </Match>
        <Match when={props.file.kind === "code" ? props.file : undefined}>
          {(file) => <CodePreview file={file()} />}
        </Match>
        <Match when={props.file.kind === "image" ? props.file : undefined}>
          {(file) => <ImagePreview file={file()} />}
        </Match>
        <Match when={props.file.kind === "unsupported" ? props.file : undefined}>
          {(file) => <UnsupportedFile path={file().path} />}
        </Match>
      </Switch>
    </div>
  )
}

function CodePreview(props: { readonly file: Extract<FileViewerFile, { kind: "code" }> }) {
  const key = `project-code:${createUniqueId()}`
  const [highlighted] = createResource(
    () => ({ source: props.file.source, language: props.file.language }),
    async (file) => {
      try {
        return { source: file.source, tokens: (await highlightStreamingCode(key, file.source, file.language, true)).stable }
      } catch (error) {
        if (
          !(error instanceof MarkdownWorkerDisposedError) &&
          !(error instanceof MarkdownWorkerSupersededError) &&
          !(error instanceof MarkdownWorkerUnavailableError)
        )
          console.error("Code highlighting failed", error)
        return { source: file.source, tokens: [[file.source, ""]] satisfies MarkdownToken[] }
      }
    },
    {
      initialValue: { source: props.file.source, tokens: [[props.file.source, ""]] satisfies MarkdownToken[] },
    },
  )
  const lines = () => {
    const current = highlighted.latest
    return codeLines(
      current?.source === props.file.source ? current.tokens : ([[props.file.source, ""]] satisfies MarkdownToken[]),
    )
  }

  onCleanup(() => disposeStreamingCode(key))

  return (
    <div data-slot="code-preview" aria-label={`Code preview: ${props.file.path}`}>
      <For each={lines()}>
        {(line, index) => (
          <div data-slot="code-line">
            <span data-slot="code-line-number" aria-hidden="true">
              {index() + 1}
            </span>
            <span data-slot="code-line-content">
              <For each={line}>{(token) => <span style={token[1]}>{token[0]}</span>}</For>
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

function codeLines(tokens: ReadonlyArray<MarkdownToken>) {
  const lines: MarkdownToken[][] = []
  const line: MarkdownToken[] = []
  tokens.forEach(([content, style]) => {
    content.split("\n").forEach((part, index, parts) => {
      if (part) line.push([part, style])
      if (index === parts.length - 1) return
      lines.push(line.splice(0))
    })
  })
  if (line.length || lines.length === 0) lines.push(line)
  return lines
}

function HtmlPreview(props: { readonly path: string; readonly source: string }) {
  return (
    <iframe
      data-slot="html-preview"
      title={`HTML preview: ${props.path}`}
      sandbox=""
      srcdoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data: blob:">${props.source}`}
    />
  )
}

function ImagePreview(props: { readonly file: Extract<FileViewerFile, { kind: "image" }> }) {
  const [source, setSource] = createSignal("")
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")

  createEffect(() => {
    const url = URL.createObjectURL(props.file.data)
    setState("loading")
    setSource(url)
    onCleanup(() => URL.revokeObjectURL(url))
  })

  return (
    <div data-slot="image-preview" data-state={state()}>
      <Show when={state() === "loading"}>
        <p role="status">Loading image…</p>
      </Show>
      <Show when={state() === "error"}>
        <p role="alert">Unable to display {filename(props.file.path)}</p>
      </Show>
      <img src={source()} alt={props.file.path} onLoad={() => setState("ready")} onError={() => setState("error")} />
    </div>
  )
}

function UnsupportedFile(props: { readonly path: string }) {
  return (
    <div data-slot="unsupported-file">
      <strong>{filename(props.path)}</strong>
      <p>Preview is not available for this file type.</p>
    </div>
  )
}

const filename = (path: string) => path.split("/").at(-1) ?? path
