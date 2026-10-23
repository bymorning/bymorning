import type { Projection } from "./markdown-stream"

export type MarkdownToken = [content: string, style: string]
export type MarkdownWorkerRequest =
  | { type: "parse"; id: number; text: string }
  | { type: "project"; id: number; key: string; text: string; live: boolean }
  | { type: "highlight"; id: number; key: string; text: string; language: string; complete?: boolean }
  | { type: "dispose"; key: string }
export type MarkdownWorkerResponse =
  | { type: "parse"; id: number; html: string }
  | { type: "project"; id: number; key: string; projection: Projection }
  | {
      type: "highlight"
      id: number
      key: string
      language: string
      reset: boolean
      stable: MarkdownToken[]
      unstable: MarkdownToken[]
    }
  | { type: "error"; id: number; key?: string; message: string }
  | { type: "superseded"; id: number; key: string }

export type MarkdownWorkerState = {
  readonly id: number
  readonly generation: number
  readonly language: string
  readonly stable: MarkdownToken[]
  readonly unstable: MarkdownToken[]
}

export function applyMarkdownWorkerResponse(
  state: MarkdownWorkerState | undefined,
  response: Extract<MarkdownWorkerResponse, { type: "highlight" }>,
): MarkdownWorkerState {
  if (state && response.id <= state.id) return state
  return {
    id: response.id,
    generation: (state?.generation ?? 0) + (response.reset ? 1 : 0),
    language: response.language,
    stable: response.reset ? response.stable : [...(state?.stable ?? []), ...response.stable],
    unstable: response.unstable,
  }
}

export const shouldReleaseMarkdownWorkerState = (complete: boolean, latestID: number | undefined, responseID: number) =>
  complete && latestID === responseID

export const markdownBlockKey = (owner: string, cacheKey: string | undefined, index: number, mode: string) =>
  `${owner}:${cacheKey ? `${cacheKey}:${index}:${mode}` : `block:${index}`}`
