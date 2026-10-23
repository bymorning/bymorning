import type { MarkdownToken } from "./markdown-worker-protocol"

export type RenderedCodeState = {
  readonly language: string
  readonly generation: number
  readonly stableCount: number
  readonly unstable: MarkdownToken[]
  readonly raw: string
}

export function shouldResetCodeTokens(
  previous: RenderedCodeState | undefined,
  next: { readonly language: string; readonly generation: number; readonly stableCount: number; readonly raw: string },
) {
  return (
    !previous ||
    previous.language !== next.language ||
    previous.generation !== next.generation ||
    next.stableCount < previous.stableCount ||
    !next.raw.startsWith(previous.raw)
  )
}
