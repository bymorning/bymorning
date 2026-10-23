/** The private bridge which exposes discovered MCP tools in the Tool registry. */
export * as McpTool from "./mcp.js"

import { Context, Effect, Fiber, PubSub, Stream, Semaphore, Layer, type Scope } from "effect"
import type { JsonSchema } from "effect"
import { Event } from "@bymorning/schema/outbound-mcp"
import { Tool } from "@bymorning/schema/tool"
import { Bus } from "../bus.js"
import { Mcp } from "../mcp.js"

/** The stable namespace used by remote MCP tools. */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
/** The stable registered name used by a remote MCP tool. */
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export interface Interface {
  /** Wait until the first remote catalog has been admitted to Tool. */
  readonly flush: Effect.Effect<void>
  /** Reconcile the current remote catalog before the caller continues. */
  readonly refresh: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/McpTool") {}

const inputSchema = (schema: unknown): JsonSchema.JsonSchema => {
  const value = (schema ?? {}) as JsonSchema.JsonSchema
  return { ...value, type: "object", properties: value.properties ?? {}, additionalProperties: false }
}

interface Registry {
  readonly transform: (
    callback: (editor: {
      readonly add: (tool: Tool.Registration) => void
    }) => void,
  ) => Effect.Effect<unknown, never, Scope.Scope>
  readonly reload: () => Effect.Effect<unknown>
}

export const layer = (tools: Registry) => Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const lock = Semaphore.makeUnsafe(1)
    let discovered: ReadonlyArray<Mcp.RemoteTool> = []

    const read = Effect.gen(function* () {
      discovered = yield* mcp.tools()
    })

    // Start discovery independently so the change subscription is live while
    // initial remote catalogs settle. The initial fiber owns one stable edit.
    const initial = yield* lock.withPermit(Effect.gen(function* () {
      yield* read
      yield* tools.transform((editor) => {
      for (const remote of discovered) {
        const server = remote.server
        const remoteName = remote.name
        editor.add({
          name: remoteName,
          description: remote.description ?? "",
          input: inputSchema(remote.inputSchema),
          // MCP output schemas are optional; the adapter nevertheless always
          // returns machine output, so admit the upstream unconstrained schema.
          output: (remote.outputSchema ?? {}) as JsonSchema.JsonSchema,
          options: { namespace: namespace(server), codemode: remote.codemode !== false, permission: remote.action },
          execute: (input, context) =>
            Effect.gen(function* () {
              // This is deliberately the caller's callback: gateway callers cannot
              // obtain approval, and session callers retain their normal policy.
              yield* context.permission({
                action: remote.action,
                resources: ["*"],
                save: ["*"],
                metadata: {},
              })
              const result = yield* mcp.callTool({
                server,
                name: remoteName,
                args: (input ?? {}) as Record<string, unknown>,
                ...(context.caller.type === "session" ? { sessionID: context.caller.sessionID } : {}),
                elicit: context.elicit,
              }).pipe(
                Effect.catchTags({
                  "Mcp.NotFoundError": (error) => Effect.fail(new Tool.Error({ message: `MCP server "${error.server}" is not available` })),
                  "Mcp.ToolCallError": (error) => Effect.fail(new Tool.Error({ message: error.message })),
                  "Mcp.NeedsAuthError": (error) =>
                    Effect.fail(new Tool.Error({ message: `MCP server "${error.server}" requires authentication; use mcp_connect before trying again` })),
                }),
              )
              if (result.isError) {
                return yield* new Tool.Error({
                  message: result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim() || "MCP tool returned an error",
                })
              }
              const content = result.content.map((part) => {
                if (part.type === "text") return { type: "text" as const, text: part.text }
                if (part.type === "resource") {
                  if (part.text !== undefined) return { type: "text" as const, text: part.text }
                  if (part.blob !== undefined) {
                    const mime = part.mimeType ?? "application/octet-stream"
                    return { type: "file" as const, uri: `data:${mime};base64,${part.blob}`, mime }
                  }
                  return { type: "text" as const, text: part.uri }
                }
                return { type: "file" as const, uri: `data:${part.mimeType};base64,${part.data}`, mime: part.mimeType }
              })
              const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")
              return { output: result.structured ?? (text === "" ? null : text), ...(content.length === 0 ? {} : { content }) }
            }),
        })
      }
      })
    })).pipe(Effect.forkScoped)

    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        yield* read
        yield* tools.reload()
      }),
    )

    // Status changes affect the mcp_connect catalog even when no remote catalog
    // exists yet, so reconcile them immediately. Remote catalog churn remains
    // debounced below.
    const statusChanges = yield* bus.subscribe(Event.StatusChanged)
    yield* statusChanges.pipe(
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )

    // Subscribe eagerly, then debounce only the already-open remote-catalog refresh stream.
    const changes = yield* PubSub.sliding<void>(1)
    const toolChanges = yield* bus.subscribe(Event.ToolsChanged)
    yield* toolChanges.pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.forkScoped({ startImmediately: true }),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )

    return Service.of({
      flush: Fiber.join(initial),
      refresh: reconcile,
    })
  }),
)
