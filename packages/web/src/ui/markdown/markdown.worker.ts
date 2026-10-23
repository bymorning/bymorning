/// <reference lib="webworker" />
/* oxlint-disable unicorn/prefer-add-event-listener, unicorn/require-post-message-target-origin -- Worker messaging has no target origin. */

import { ShikiStreamTokenizer } from "@shikijs/stream"
import { bundledLanguages, createHighlighter, getTokenStyleObject, stringifyTokenStyle, type ThemedToken } from "shiki"

import { createMarkdownParser } from "./markdown-parser"
import { project, type Projection } from "./markdown-stream"
import { ByMorningTheme } from "./markdown-theme"
import { createLatestWorkerQueue } from "./markdown-worker-queue"
import type { MarkdownToken, MarkdownWorkerRequest, MarkdownWorkerResponse } from "./markdown-worker-protocol"

type Stream = { language: string; source: string; tokenizer: ShikiStreamTokenizer }
const streams = new Map<string, Stream>()
const projections = new Map<string, Projection>()
let highlighter: ReturnType<typeof createHighlighter> | undefined
const highlightQueue = createLatestWorkerQueue<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  run: highlight,
  supersede: (request) => post({ type: "superseded", id: request.id, key: request.key }),
  dispose: (key) => void streams.delete(key),
})
const projectQueue = createLatestWorkerQueue<Extract<MarkdownWorkerRequest, { type: "project" }>>({
  run: runProject,
  supersede: (request) => post({ type: "superseded", id: request.id, key: request.key }),
  dispose: (key) => void projections.delete(key),
})
const parser = createMarkdownParser(async (code, language) => {
  const instance = await getHighlighter()
  const name = supportedLanguage(language)
  if (name !== "text" && !instance.getLoadedLanguages().includes(name))
    await instance.loadLanguage(bundledLanguages[name])
  return instance
    .codeToHtml(code, { lang: name, theme: "ByMorning", tabindex: false })
    .replace("<code>", `<code class="language-${name}">`)
})

self.onmessage = (event: MessageEvent<MarkdownWorkerRequest>) => {
  const request = event.data
  if (request.type === "dispose") {
    highlightQueue.dispose(request.key)
    projectQueue.dispose(request.key)
  } else if (request.type === "parse") void parse(request)
  else if (request.type === "project") projectQueue.enqueue(request)
  else highlightQueue.enqueue(request)
}

async function parse(request: Extract<MarkdownWorkerRequest, { type: "parse" }>) {
  try {
    post({ type: "parse", id: request.id, html: await parser.parse(request.text) })
  } catch (error) {
    post({ type: "error", id: request.id, message: message(error) })
  }
}

async function runProject(request: Extract<MarkdownWorkerRequest, { type: "project" }>) {
  try {
    const projection = project(projections.get(request.key), request.text, request.live)
    projections.set(request.key, projection)
    post({ type: "project", id: request.id, key: request.key, projection })
  } catch (error) {
    post({ type: "error", id: request.id, key: request.key, message: message(error) })
  }
}

async function highlight(request: Extract<MarkdownWorkerRequest, { type: "highlight" }>) {
  try {
    const instance = await getHighlighter()
    const language = supportedLanguage(request.language)
    if (language !== "text" && !instance.getLoadedLanguages().includes(language))
      await instance.loadLanguage(bundledLanguages[language])
    if (request.complete) {
      const result = instance.codeToTokens(request.text, { lang: language, theme: "ByMorning" })
      streams.delete(request.key)
      post({
        type: "highlight",
        id: request.id,
        key: request.key,
        language,
        reset: true,
        stable: result.tokens
          .flatMap((line, index) =>
            index === result.tokens.length - 1 ? line : [...line, { content: "\n", offset: 0 }],
          )
          .map(token),
        unstable: [],
      })
      return
    }
    const previous = streams.get(request.key)
    const reset = !previous || previous.language !== language || !request.text.startsWith(previous.source)
    const current = reset
      ? {
          language,
          source: "",
          tokenizer: new ShikiStreamTokenizer({ highlighter: instance, lang: language, theme: "ByMorning" }),
        }
      : previous
    const result = await current.tokenizer.enqueue(request.text.slice(current.source.length))
    current.source = request.text
    streams.set(request.key, current)
    post({
      type: "highlight",
      id: request.id,
      key: request.key,
      language,
      reset,
      stable: result.stable.filter((value) => value.content.length > 0).map(token),
      unstable: result.unstable.filter((value) => value.content.length > 0).map(token),
    })
  } catch (error) {
    post({ type: "error", id: request.id, key: request.key, message: message(error) })
  }
}

const getHighlighter = () => (highlighter ??= createHighlighter({ themes: [ByMorningTheme], langs: [] }))
const supportedLanguage = (value: string) =>
  Object.keys(bundledLanguages).find((language): language is keyof typeof bundledLanguages => language === value) ??
  "text"
const post = (response: MarkdownWorkerResponse) => self.postMessage(response)
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const token = (value: ThemedToken): MarkdownToken => [
  value.content,
  stringifyTokenStyle(value.htmlStyle ?? getTokenStyleObject(value)),
]
