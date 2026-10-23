import type { Message } from "@opencode-ai/ai/schema/messages"
import { Catalog as CoreCatalog } from "@bymorning/core/catalog"
import { Model } from "@bymorning/core/model"
import { ModelResolver } from "@bymorning/core/model-resolver"
import type { Plugin } from "@bymorning/core/plugin"
import { Routing } from "@bymorning/core/routing"
import { Usage } from "@bymorning/core/usage"
import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Principal } from "@bymorning/schema/usage"
import type { Workspace } from "@bymorning/schema/workspace"
import { Clock, Effect, type Scope } from "effect"
import type { Exchange } from "./exchange.js"
import { Catalog } from "./catalog.js"
import { WorkspaceConfig } from "@bymorning/core/config"
import { Routing as RoutingSchema } from "@bymorning/schema/routing"

type Part = Message["content"][number]
type Role = Message["role"]
type Json = Record<string, unknown>

const record = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])
const text = (value: string): Part => ({ type: "text", text: value }) as Part
const image = (): Part => ({ type: "media", mediaType: "image/*", data: "" }) as Part
const result = (value: unknown): Part =>
  ({ type: "tool-result", id: "", name: "", result: { type: "json", value } }) as unknown as Part
const call = (value: unknown): Part => ({ type: "tool-call", id: "", name: "", input: value }) as unknown as Part
const message = (role: Role, content: ReadonlyArray<Part>) => ({ role, content }) as unknown as Message

/** Text and image parts of an OpenAI-style or Anthropic-style content value. */
const parts = (content: unknown): Part[] => {
  if (typeof content === "string") return [text(content)]
  return list(content).flatMap((part): Part[] => {
    if (typeof part === "string") return [text(part)]
    if (!record(part)) return []
    if (typeof part.text === "string" && part.type !== "tool_result") return [text(part.text)]
    if (part.type === "image_url" || part.type === "input_image" || part.type === "image") return [image()]
    return []
  })
}

const openAIChat = (body: Json) => {
  const system: string[] = []
  const messages = list(body.messages).flatMap((entry): Message[] => {
    if (!record(entry)) return []
    if (entry.role === "system" || entry.role === "developer") {
      system.push(
        parts(entry.content)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n"),
      )
      return []
    }
    if (entry.role === "tool") return [message("tool", [result(entry.content)])]
    if (entry.role === "assistant")
      return [message("assistant", [...parts(entry.content), ...list(entry.tool_calls).map(call)])]
    return [message("user", parts(entry.content))]
  })
  return { system, messages }
}

const openAIResponses = (body: Json) => {
  const system = typeof body.instructions === "string" ? [body.instructions] : []
  if (typeof body.input === "string") return { system, messages: [message("user", [text(body.input)])] }
  const messages = list(body.input).flatMap((entry): Message[] => {
    if (!record(entry)) return []
    if (entry.type === "function_call_output") return [message("tool", [result(entry.output)])]
    if (entry.type === "function_call") return [message("assistant", [call(entry.arguments)])]
    if (entry.type !== undefined && entry.type !== "message") return []
    if (entry.role === "system" || entry.role === "developer") {
      system.push(
        parts(entry.content)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n"),
      )
      return []
    }
    return [message(entry.role === "assistant" ? "assistant" : "user", parts(entry.content))]
  })
  return { system, messages }
}

const anthropicMessages = (body: Json) => {
  const system = parts(body.system).flatMap((part) => (part.type === "text" ? [part.text] : []))
  const messages = list(body.messages).flatMap((entry): Message[] => {
    if (!record(entry)) return []
    const blocks = typeof entry.content === "string" ? [] : list(entry.content).filter(record)
    if (entry.role === "assistant")
      return [
        message("assistant", [
          ...parts(entry.content),
          ...blocks.filter((block) => block.type === "tool_use").map((block) => call(block.input)),
        ]),
      ]
    // Tool results ride a user turn; they precede any participant text written alongside them.
    const results = blocks.filter((block) => block.type === "tool_result").map((block) => result(block.content))
    const written = parts(entry.content)
    return [
      ...(results.length === 0 ? [] : [message("tool", results)]),
      ...(written.length === 0 ? [] : [message("user", written)]),
    ]
  })
  return { system, messages }
}

const googleGenerate = (body: Json) => {
  const instruction = record(body.systemInstruction) ? body.systemInstruction : undefined
  const system = list(instruction?.parts).flatMap((part) =>
    record(part) && typeof part.text === "string" ? [part.text] : [],
  )
  const messages = list(body.contents).flatMap((entry): Message[] => {
    if (!record(entry)) return []
    const blocks = list(entry.parts).filter(record)
    const responses = blocks.filter((block) => block.functionResponse !== undefined)
    const written = blocks.flatMap((block): Part[] =>
      typeof block.text === "string" ? [text(block.text)] : block.inlineData !== undefined ? [image()] : [],
    )
    if (entry.role === "model")
      return [
        message("assistant", [...written, ...blocks.filter((block) => block.functionCall !== undefined).map(call)]),
      ]
    return [
      ...(responses.length === 0
        ? []
        : [
            message(
              "tool",
              responses.map((block) => result(block.functionResponse)),
            ),
          ]),
      ...(written.length === 0 ? [] : [message("user", written)]),
    ]
  })
  return { system, messages }
}

/**
 * Tolerant classification digest of a caller request body. Unlike translation, this never refuses a
 * request: fields it does not understand are ignored, and an unreadable body yields an empty digest.
 */
export const digest = (request: LLMGateway.Request): Routing.Digest => {
  if (!record(request.body)) return Routing.digest([])
  const read = {
    "openai-chat": openAIChat,
    "openai-responses": openAIResponses,
    "anthropic-messages": anthropicMessages,
    "google-generate": googleGenerate,
  }[request.protocol]
  const { system, messages } = read(request.body)
  return Routing.digest(
    messages,
    system.map((value) => ({ type: "text", text: value }) as never),
  )
}

/** The Catalog Model a caller's model name refers to, including Auto names. */
export const requested = Effect.fn("LLMGateway.route.requested")(function* (name: string) {
  const slash = name.indexOf("/")
  if (slash > 0) {
    const provider = name.slice(0, slash)
    const id = name.slice(slash + 1)
    return { provider, id } as ModelSchema.Ref
  }
  const catalog = yield* CoreCatalog.Service
  const info = (yield* catalog.model.all()).find((candidate) => Model.publicID(candidate) === name)
  return info === undefined ? undefined : ({ provider: info.provider, id: info.id } as ModelSchema.Ref)
})

/** Gateway model name for a routed Catalog Model. */
export const name = (model: ModelSchema.Ref) => `${model.provider}/${model.id}`

/**
 * Auto names a caller format can use: those with at least one rule target, or one Tier, that the
 * format can reach. A Claude Code picker therefore lists only Auto names backed by Anthropic Models.
 */
export const auto = Effect.fn("LLMGateway.route.auto")(function* (protocol: LLMGateway.Protocol) {
  const routing = yield* Routing.Service
  const config = yield* WorkspaceConfig.Service
  const catalog = yield* Catalog.Service
  const rules = (yield* config.get).routing ?? []
  const entries: LLMGateway.Entry[] = []
  for (const auto of yield* routing.names) {
    const targets = rules.flatMap((rule) =>
      rule.match.model !== undefined && Routing.isAuto(rule.match.model) && rule.match.model.id === auto.id
        ? RoutingSchema.isTiers(rule.to)
          ? rule.to.tiers.map((tier) => tier.model)
          : [rule.to]
        : [],
    )
    const reachable = yield* Effect.forEach(targets, (model) =>
      catalog.resolve(name(model), protocol).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      ),
    )
    if (reachable.some(Boolean)) entries.push({ id: name(auto), name: `Auto · ${auto.id}` })
  }
  return entries
})

export interface JudgeInput {
  readonly exchange: Exchange.Interface
  readonly hooks: Plugin.Hooks.Interface
  readonly workspaceID: Workspace.ID
  /** Caller principal the judge's inference usage is attributed to. */
  readonly principal: Principal
  readonly protocol: LLMGateway.Protocol
  readonly requestID: () => Effect.Effect<string>
  readonly reserve: (
    estimate?: number,
  ) => Effect.Effect<{ readonly settle: (amount: number) => Effect.Effect<void, unknown> }, unknown, Scope.Scope>
}

/**
 * Judge callback for Gateway Routing. The judge is its own inference: a separate Budget reservation
 * for the caller's Holders, Workspace admission through `model.invoke`, one `inference` Usage record,
 * and its own settlement. None of this touches the caller's invocation reservation.
 */
export const judge =
  (input: JudgeInput) =>
  (
    request: Routing.JudgeRequest,
  ): Effect.Effect<Routing.JudgeReply, unknown, CoreCatalog.Service | ModelResolver.Service | Usage.Service> =>
    Effect.scoped(
      Effect.gen(function* () {
        const catalog = yield* CoreCatalog.Service
        const resolver = yield* ModelResolver.Service
        const usage = yield* Usage.Service
        const execution = yield* catalog.model.requireExecution(request.model)
        const destination = yield* resolver.prepare({ execution, headers: {} })
        const info = destination.selection.info
        const reservation = yield* input.reserve()
        const requestID = yield* input.requestID()
        const invocation = yield* input.hooks.open({
          domain: "gateway",
          event: Object.freeze({
            id: requestID,
            workspaceID: input.workspaceID,
            model: Object.freeze({ provider: info.provider, id: info.id }),
            publicModel: Model.publicID(info),
            stream: false,
            protocol: input.protocol,
          }),
        })
        const reply = yield* input.exchange.judge({ destination, system: request.system, prompt: request.prompt })
        if (reply.tokens === undefined) return { text: reply.text }
        const { cost } = yield* usage.record({
          requestID,
          model: Model.publicID(info),
          endpointID: `${info.provider}/${info.id}`,
          upstreamModel: info.apiID,
          selection: info,
          tokens: reply.tokens,
          occurredAt: new Date(yield* Clock.currentTimeMillis),
          principal: input.principal,
        })
        yield* reservation.settle(cost)
        yield* invocation.usage(Object.freeze({ ...reply.tokens }))
        return { text: reply.text, cost }
      }),
    )
