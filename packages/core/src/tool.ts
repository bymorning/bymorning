export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@bymorning/schema/tool"
export type {
  Caller,
  Context,
  ElicitInput,
  ElicitResult,
  Implementation,
  Info,
  Language,
  Metadata,
  Namespace,
  Options,
  PermissionRequest,
  Registration,
  Result,
  ValueSchema,
} from "@bymorning/schema/tool"

import { Tool } from "@bymorning/schema/tool"
import type { Plugin } from "@bymorning/schema/plugin"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Permission } from "@bymorning/schema/permission"
import { ToolDefinition, type ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Context, Effect, Layer, Option, Schema, Types } from "effect"
import { makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { State } from "./state.js"
import { CodeModeTool } from "./codemode/tool.js"
import type { CodeModeCatalog } from "./codemode/catalog.js"
import { whollyDenied } from "./permission/evaluation.js"
import { CodeInterpreter } from "./code-interpreter.js"
import { Storage } from "./storage.js"
import { Bus } from "./bus.js"
import { Mcp } from "./mcp.js"
import { Runtime } from "./tool/runtime.js"
import { PluginHooks } from "./plugin/hooks.js"
import { McpTool } from "./tool/mcp.js"

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Editor {
  readonly list: () => readonly (Tool.Info & { readonly id: string })[]
  readonly get: (id: string) => (Tool.Info & { readonly id: string }) | undefined
  readonly namespace: (value: Tool.Namespace) => void
  readonly add: (value: Tool.Registration) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}
export interface Interface extends State.Transformable<Editor> {
  /** Current registrations and the Permission action each execution asserts. */
  readonly actions: () => Effect.Effect<ReadonlyArray<Action>>
  readonly snapshot: (permissions?: Permission.Ruleset, caller?: Tool.Caller["type"]) => Effect.Effect<Snapshot>
}
export interface Action {
  readonly name: string
  readonly action: string
  readonly description: string
}
export interface NormalizedResult extends Tool.Result {
  readonly content: ReadonlyArray<Tool.Content>
}
export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly call: ToolCallPart
    readonly context: Tool.Context
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<NormalizedResult, Tool.Error>
}
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@opencode/Tool") {}

const Provenance = Context.Reference<{
  readonly source: Plugin.Source
  readonly workspaceID?: Workspace.ID
}>("@bymorning/Tool/Provenance", { defaultValue: () => ({ source: { type: "builtin" } }) })

/** @internal Host-only admission provenance. Not a plugin capability or an execution authorization. */
export const withSource = <A, E, R>(effect: Effect.Effect<A, E, R>, source: Plugin.Source, workspaceID: Workspace.ID) =>
  effect.pipe(Effect.provideService(Provenance, { source, workspaceID }))

type Item = Tool.Info & { readonly id: string }
type Data = {
  tools: Map<string, Item>
  namespaces: Map<string, Tool.Namespace>
  sources: Map<string, Plugin.Source>
  errors: RegistrationError[]
}

const namespaceError = (name: string) =>
  name.split(".").every((part) => /^[A-Za-z0-9_-]{1,64}$/.test(part))
    ? undefined
    : new RegistrationError({ name, message: `Invalid tool namespace: ${JSON.stringify(name)}` })
const registrationError = (tool: Tool.Info) => {
  if (tool.options?.namespace !== undefined) {
    const error = namespaceError(tool.options.namespace)
    if (error) return error
  }
  const name = Runtime.normalizedName(tool)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return new RegistrationError({ name, message: `Invalid tool name: ${name}` })
  const id = Runtime.effectiveName(tool)
  if (tool.options?.codemode === false && id === "execute")
    return new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' })
  if (typeof tool.execute !== "function")
    return new RegistrationError({ name: id, message: "Tool must have an executable callback" })
  try {
    ToolDefinition.make(Runtime.definition(tool))
  } catch (error) {
    return new RegistrationError({
      name: id,
      message: `Invalid tool definition ${id}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

export const make = Effect.gen(function* () {
  const hooks = yield* PluginHooks.Service
  // A host-only registry needs no sandbox infrastructure. Capture optional
  // adapters at construction, not inside Plugin's intentionally stripped Scope.
  // Production workspaceNodes supplies both explicitly; unsupported sandbox
  // calls fail with Tool.Error rather than constructing a fallback identity.
  const interpreter = Option.getOrUndefined(yield* Effect.serviceOption(CodeInterpreter.Service))
  const storage = Option.getOrUndefined(yield* Effect.serviceOption(Storage.Service))
  const before = (
    name: string,
    input: unknown,
    context: Tool.Context,
  ): Effect.Effect<{ tool: string; input: unknown }, Tool.Error> =>
    context.caller.type === "gateway"
      ? Effect.succeed({ tool: name, input })
      : hooks.trigger("tool", "execute.before", { tool: name, input, ...context.caller, id: context.id })
  const executeTool = (tool: Tool.Info, name: string, input: unknown, context: Tool.Context) =>
    Effect.gen(function* () {
      const result = yield* Runtime.execute(tool, input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (error) => Effect.succeed({ error })),
      )
      if (context.caller.type === "gateway") return "error" in result ? yield* result.error : result.value
      const base = { tool: name, input, ...context.caller, id: context.id }
      if ("error" in result) {
        const event = { ...base, status: "error" as const, error: result.error }
        yield* hooks.trigger("tool", "execute.after", event)
        return yield* event.error
      }
      const event = { ...base, status: "completed" as const, result: result.value as Tool.Result }
      yield* hooks.trigger("tool", "execute.after", event)
      return { ...event.result, content: Runtime.normalizeContent(event.result.content, event.result.output) }
    })
  // These variables are only used during a synchronous State replay callback.
  let source = { type: "builtin" } as Plugin.Source
  let admit: (tool: Tool.Registration) => Tool.Info | RegistrationError
  const state = State.create<Data, Editor>({
    name: "tool",
    initial: () => ({ tools: new Map(), namespaces: new Map(), sources: new Map(), errors: [] }),
    editor: (data) => ({
      list: () => Array.from(data.tools.values()),
      get: (id) => data.tools.get(id),
      namespace: (value) => {
        const error = namespaceError(value.name)
        if (error) {
          data.errors.push(error)
          return
        }
        data.namespaces.set(value.name, { ...value })
      },
      add: (registration) => {
        const tool = admit(registration)
        if (tool instanceof RegistrationError) {
          data.errors.push(tool)
          return
        }
        const error = registrationError(tool)
        if (error) {
          data.errors.push(error)
          return
        }
        const id = Runtime.effectiveName(tool)
        data.tools.set(id, { ...tool, id, options: tool.options && { ...tool.options } })
        data.sources.set(id, source)
      },
      update: (id, update) => {
        const current = data.tools.get(id)
        if (!current) return
        const tool = { ...current, options: current.options && { ...current.options } }
        update(tool)
        tool.name = current.name
        tool.id = id
        if (tool.options?.namespace !== current.options?.namespace)
          tool.options = { ...tool.options, namespace: current.options?.namespace }
        const error = registrationError(tool)
        if (error) {
          data.errors.push(error)
          return
        }
        data.tools.set(id, tool)
        data.sources.set(id, source)
      },
      remove: (id) => {
        data.tools.delete(id)
        data.sources.delete(id)
      },
    }),
    // Upstream 429387d158: read errors when the notification runs, not when State is created.
    notify: () =>
      Effect.suspend(() =>
      Effect.forEach(
        state.get().errors,
        (error) => Effect.logError("Skipping invalid tool registration", { name: error.name, error: error.message }),
        { discard: true },
      ),
      ),
  }) as State.Interface<Data, Editor>

  return Service.of({
    actions: () =>
      Effect.sync(() =>
        [...state.get().tools].map(([name, tool]) => ({
          name,
          action: tool.options?.permission ?? name,
          description: tool.description,
        })),
      ),
    transform: Effect.fn("Tool.transform")(function* (callback) {
      const provenance = yield* Provenance
      return yield* state.transform((editor) => {
        source = provenance.source
        admit = (registration) => {
          const candidate = registration as unknown as Record<string, unknown>
          const invalid = (message: string) => new RegistrationError({ name: registration.name, message })
          if (typeof candidate.execute === "function") {
            if (candidate.execution !== undefined || candidate.implementation !== undefined)
              return invalid("Host Tools declare execute without an execution discriminator or implementation")
            return registration as Tool.Info
          }
          if (candidate.execution !== "sandbox" || !Schema.is(Tool.Implementation)(candidate.implementation))
            return invalid("Sandbox Tools require a valid implementation and execution: sandbox")
          if (candidate.implementation.type === "project-file" && provenance.source.type !== "project")
            return invalid("Project File Tools must be registered by a Project plugin")
          return Runtime.sandbox(
            registration as Tool.SandboxRegistration,
            provenance.source,
            provenance.workspaceID,
            interpreter,
            storage,
          )
        }
        callback(editor)
      })
    }),
    reload: state.reload,
    snapshot: Effect.fn("Tool.snapshot")((permissions = [], caller = "session") =>
      Effect.sync(() => {
        const active = new Map<string, Tool.Info>()
        const data = state.get()
        for (const [name, tool] of data.tools) {
          // Built-ins remain private to the agent harness unless their producer
          // deliberately opts them into the external gateway. Provenance alone
          // is not an authorization shortcut.
          if (caller === "gateway" && data.sources.get(name)?.type === "builtin" && tool.options?.gateway !== true) continue
          if (whollyDenied(tool.options?.permission ?? name, permissions)) continue
          active.set(name, tool)
        }
        const direct = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
        const inventory = {
          tools: new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false)),
          namespaces: data.namespaces,
          definition: Runtime.definition,
        }
        const codeModeTool = whollyDenied("execute", permissions)
          ? undefined
          : CodeModeTool.create(inventory, (name, tool, input, context) =>
              before(name, input, context).pipe(
                Effect.flatMap((event) => executeTool(tool, name, event.input, context)),
              ),
            )
        return {
          ...(codeModeTool === undefined ? {} : { codeModeCatalog: CodeModeTool.catalog(inventory) }),
          definitions: [
            ...Array.from(direct)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([, tool]) => Runtime.definition(tool)),
            ...(codeModeTool === undefined ? [] : [Runtime.definition(codeModeTool)]),
          ],
          execute: Effect.fn("Tool.snapshot.execute")(function* ({
            call,
            context,
            definitions,
          }: Parameters<Snapshot["execute"]>[0]) {
            if (context.caller.type !== caller)
              return yield* new Tool.Error({ message: "Tool snapshot caller mismatch" })
            if (context.id !== call.id) return yield* new Tool.Error({ message: "Tool call identity mismatch" })
            const event = yield* before(call.name, call.input, context)
            const requested = definitions?.get(event.tool)
            if (!requested && definitions && (direct.has(event.tool) || codeModeTool?.name === event.tool))
              return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
            const name = requested?.name ?? event.tool
            const tool = name === "execute" ? codeModeTool : direct.get(name)
            if (tool === undefined) return yield* new Tool.Error({ message: `Unknown tool: ${name}` })
            if (name === "execute" && caller === "gateway")
              yield* context.permission({ action: "execute", resources: ["*"], save: ["*"] })
            return yield* executeTool(tool, name, event.input, context)
          }),
        }
      }),
    ),
  })
})

export const layer = Layer.effect(Service, make)
export const node = makeWorkspaceNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, CodeInterpreter.node, Storage.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(dependencies: {
  readonly hooks: WorkspaceNode<PluginHooks.Service, E>
  readonly interpreter: GlobalNode<CodeInterpreter.Service, E>
  readonly storage: GlobalNode<Storage.Service, E>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer,
    deps: [dependencies.hooks, dependencies.interpreter, dependencies.storage],
  })

/** Awaits initial remote MCP Tool discovery from the canonical Workspace bridge. */
const mcpDiscovery = Layer.effectDiscard(McpTool.Service.use((adapter) => adapter.flush))
const mcpLayer = Layer.unwrap(Service.use((tools) => Effect.succeed(McpTool.layer(tools)))).pipe(
  Layer.provide(Layer.succeed(Provenance, { source: { type: "sdk" } })),
)

/** Focused composition for callers outside the canonical Workspace graph. */
export const discovery = mcpDiscovery.pipe(
  Layer.provideMerge(mcpLayer),
)

/** Canonical Workspace node for remote MCP Tool discovery. */
export const bridge = makeWorkspaceNode({
  service: McpTool.Service,
  layer: mcpLayer,
  deps: [Mcp.node, node, Bus.node],
})

/** Wait until the canonical remote MCP Tool bridge has admitted its initial catalog. */
export const ready = McpTool.Service.use((adapter) => adapter.flush)

/** @internal Host-facing OpenAPI producer; the host supplies its provenance-scoped transform. */
export { register as openapi } from "./tool/openapi.js"
