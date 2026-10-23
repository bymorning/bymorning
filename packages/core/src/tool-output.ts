/** Exposes bounded Tool output and durable retrieval. */
export * as ToolOutput from "./tool-output.js"

import type { Session } from "@bymorning/schema/session"
import { Tool } from "@bymorning/schema/tool"
import { ID, Page, ReadInput } from "@bymorning/schema/tool-output"
import type { Workspace } from "@bymorning/schema/workspace"
import { ConfigToolOutput } from "@bymorning/schema/config/tool-output"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { Config } from "./config.js"
import { Storage } from "./storage.js"
import { makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "./actor.js"

/** Stored output cannot be read, without disclosing whether it exists. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("ToolOutput.UnavailableError", {}) {}

export interface Interface {
  /** Bound a Tool result, storing oversized joined text under the owning Session. */
  readonly truncate: (sessionID: Session.ID, result: Tool.Result) => Effect.Effect<Tool.Result>
  /** Read one bounded UTF-8 page of a previously stored output. */
  readonly read: (sessionID: Session.ID, outputID: ID, input?: ReadInput) => Effect.Effect<Page, UnavailableError>
  /** Read one bounded preview, followed by model-visible continuation guidance when more content remains. */
  readonly readForTool: (
    sessionID: Session.ID,
    outputID: ID,
    input?: ReadInput,
  ) => Effect.Effect<Page, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ToolOutput") {}

/** Workspace-bound Tool Output implementation backed by provider-independent Storage. */
export const layer = (workspaceID: Workspace.ID) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const { object: storage } = yield* Storage.Service

      const truncate = Effect.fn("ToolOutput.truncate")(function* (sessionID: Session.ID, result: Tool.Result) {
        const content =
          typeof result.content === "string"
            ? [{ type: "text" as const, text: result.content }]
            : (result.content ?? [])
        const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
        const limits = (yield* config.get).tool_output ?? ConfigToolOutput.defaults
        const encoder = new TextEncoder()
        const retrievalPreview = previewBeforeContinuation(text, result.metadata)
        const previewText = retrievalPreview ?? text
        const bytes = encoder.encode(text)
        const previewTextBytes = encoder.encode(previewText)
        const lines = previewText.split("\n")
        if (lines.length <= limits.max_lines && previewTextBytes.length <= limits.max_bytes) {
          return {
            ...result,
            ...(typeof result.content === "string" ? { content } : {}),
            metadata: {
              ...result.metadata,
              truncated: typeof result.metadata?.truncated === "boolean" ? result.metadata.truncated : false,
            },
          }
        }

        const previewLines: string[] = []
        let previewBytes = 0
        let hitBytes = false
        for (let index = 0; index < lines.length && index < limits.max_lines; index++) {
          const line = lines[index] ?? ""
          const size = encoder.encode(line).length + (index > 0 ? 1 : 0)
          if (previewBytes + size > limits.max_bytes) {
            hitBytes = true
            break
          }
          previewLines.push(line)
          previewBytes += size
        }
        const preview = previewLines.join("\n")
        const removed = hitBytes ? previewTextBytes.length - previewBytes : lines.length - previewLines.length
        const unit = hitBytes ? (removed === 1 ? "byte" : "bytes") : removed === 1 ? "line" : "lines"
        const outputID = ID.create()
        const stored = yield* storage
          .set(path(workspaceID, sessionID, outputID), {
            body: Stream.succeed(bytes),
            contentType: "text/plain; charset=utf-8",
            contentLength: bytes.length,
          })
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
        const marker = stored
          ? `... ${removed} ${unit} truncated; full content saved as ${outputID} ...`
          : `... ${removed} ${unit} truncated; full content unavailable ...`
        const bounded: Tool.Content[] = []
        let remaining = preview.length
        let seenText = false
        let marked = false
        for (const item of content) {
          if (item.type === "file") {
            bounded.push(item)
            continue
          }
          if (seenText && remaining > 0) remaining--
          seenText = true
          if (remaining >= item.text.length) {
            bounded.push(item)
            remaining -= item.text.length
            continue
          }
          if (remaining > 0) bounded.push({ ...item, text: item.text.slice(0, remaining) })
          if (!marked) bounded.push({ type: "text", text: marker })
          remaining = 0
          marked = true
        }
        if (!marked) bounded.push({ type: "text", text: marker })
        const { truncated: _truncated, outputID: _outputID, ...producerMetadata } = result.metadata ?? {}
        return {
          ...result,
          content: bounded,
          metadata: {
            ...producerMetadata,
            truncated: true,
            ...(stored ? { outputID } : {}),
          },
        }
      })

      const read = Effect.fn("ToolOutput.read")(function* (sessionID: Session.ID, outputID: ID, input: ReadInput = {}) {
        return yield* Effect.gen(function* () {
          const cursor = input.cursor ?? 0
          const limits = (yield* config.get).tool_output ?? ConfigToolOutput.defaults
          const limit = Math.min(input.limit ?? limits.max_bytes, limits.max_bytes)
          const available = Number.MAX_SAFE_INTEGER - cursor
          const requested = Math.min(limit, available)
          const entry = yield* storage.getRange(path(workspaceID, sessionID, outputID), {
            offset: cursor,
            length: requested + Math.min(3, available - requested),
          })
          if (Option.isNone(entry)) return yield* new UnavailableError({})
          const size = entry.value.metadata.contentLength
          if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || cursor > size)
            return yield* new UnavailableError({})
          const bytes = yield* Stream.mkUint8Array(entry.value.body)
          if (cursor === size) return { content: "", cursor, size }
          if (bytes.length === 0 || isContinuation(bytes[0])) {
            return yield* new UnavailableError({})
          }
          const requestedEnd = Math.min(bytes.length, limit, size - cursor)
          let end = requestedEnd
          while (end < bytes.length && end < size - cursor && isContinuation(bytes[end])) end++
          const content = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, end)))
          return { content, cursor: cursor + end, size }
        }).pipe(Effect.mapError(() => new UnavailableError({})))
      })

      const readForTool = Effect.fn("ToolOutput.readForTool")(function* (
        sessionID: Session.ID,
        outputID: ID,
        input: ReadInput = {},
      ) {
        const limits = (yield* config.get).tool_output ?? ConfigToolOutput.defaults
        return boundToolPage(yield* read(sessionID, outputID, input), outputID, limits)
      })

      return Service.of({ truncate, read, readForTool })
    }),
  )

/** Canonical bounded Tool output node for one Workspace. */
export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  dependencies: {
    readonly config: WorkspaceNode<Config.Service, E>
    readonly storage: GlobalNode<Storage.Service, E>
  },
) =>
  makeWorkspaceNode({ service: Service, layer: layer(workspaceID), deps: [dependencies.config, dependencies.storage] })

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Config.node, Storage.node],
})

const path = (workspaceID: Workspace.ID, sessionID: Session.ID, outputID: ID) =>
  Storage.path("tool-output", { workspace: workspaceID }, { session: sessionID }, { output: outputID }, "content")

const isContinuation = (byte: number | undefined) => byte !== undefined && byte >= 0x80 && byte < 0xc0

const boundToolPage = (page: Page, outputID: ID, limits: ConfigToolOutput.Info): Page => {
  const encoder = new TextEncoder()
  const boundaries = [{ index: 0, bytes: 0, lines: 1 }]
  let bytes = 0
  let lines = 1
  for (const character of page.content) {
    bytes += encoder.encode(character).length
    if (character === "\n") lines++
    boundaries.push({ index: boundaries.at(-1)!.index + character.length, bytes, lines })
  }

  const fittingContent = boundaries.filter(
    (boundary) => boundary.bytes <= limits.max_bytes && boundary.lines <= limits.max_lines,
  )
  const full = fittingContent.at(-1)!
  const contentCursor = page.cursor - bytes + full.bytes
  if (contentCursor === page.size)
    return { content: page.content.slice(0, full.index), cursor: contentCursor, size: page.size }
  return {
    // Like OpenCode's truncation marker, retrieval guidance is outside the preview budget.
    content: `${page.content.slice(0, full.index)}\n\n${continuation(outputID, contentCursor)}`,
    cursor: contentCursor,
    size: page.size,
  }
}

const continuation = (outputID: string, cursor: number) =>
  `[More output is available. Call tool_output with {"outputID":"${outputID}","cursor":${cursor}} to continue.]`

const previewBeforeContinuation = (text: string, metadata: Tool.Metadata | undefined) => {
  const outputID = metadata?.outputID
  const next = metadata?.next
  if (!Schema.is(ID)(outputID) || typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) return undefined
  const instruction = continuation(outputID, next)
  // Bound the exempt suffix even though IDs from this service are currently fixed length.
  if (new TextEncoder().encode(instruction).length > 256) return undefined
  const suffix = `\n\n${instruction}`
  if (!text.endsWith(suffix)) return undefined
  return text.slice(0, -suffix.length)
}
