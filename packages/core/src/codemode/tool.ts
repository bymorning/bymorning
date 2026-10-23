export * as CodeModeTool from "./tool.js"

import { CodeMode, Namespace, Tool, toolError } from "@opencode-ai/codemode"
import type { Tool as SchemaTool } from "@bymorning/schema/tool"
import type { ToolDefinition } from "@opencode-ai/ai/schema/messages"
import { Effect, Ref, Schema, Semaphore } from "effect"
import { CodeModeCatalog } from "./catalog.js"

export type Inventory = {
  readonly tools: ReadonlyMap<string, SchemaTool.Info>
  readonly namespaces?: ReadonlyMap<string, SchemaTool.Namespace>
  readonly definition: (tool: SchemaTool.Info) => ToolDefinition
}
type Node<T> = { tool?: T; namespace?: SchemaTool.Namespace; readonly children: Map<string, Node<T>> }
type Tools = { [name: string]: Tool.Tool<never> | Tools | Namespace.Namespace<never> }

const ExecuteFile = Schema.Struct({ data: Schema.String, mime: Schema.String, name: Schema.optionalKey(Schema.String) })
const ExecuteCall = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})
const ExecuteInput = Schema.Struct({
  description: Schema.String.annotate({
    description: "A short 3-5 word label for the task, displayed to the user",
  }),
  code: Schema.String,
})
const ExecuteOutput = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(ExecuteCall),
  error: Schema.optionalKey(Schema.Literal(true)),
  files: Schema.Array(ExecuteFile),
})

const description = [
  "Run JavaScript in a confined Code Mode runtime to orchestrate tool calls and compose their results.",
  "Imports, direct filesystem access, and timers are unavailable. Do not use `fetch`; all external access goes through `tools`.",
  "Within `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by `search`. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
  'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
  "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
  "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.all`.",
].join("\n")

export const create = (
  inventory: Inventory,
  executeTool: (
    name: string,
    tool: SchemaTool.Info,
    input: unknown,
    context: SchemaTool.Context,
  ) => Effect.Effect<SchemaTool.Result, SchemaTool.Error>,
): SchemaTool.Info => ({
  name: "execute",
  description,
  input: ExecuteInput,
  output: ExecuteOutput,
  execute: ({ code }, context) =>
    Effect.gen(function* () {
      const callIndex = yield* Ref.make(0)
      const files = yield* Ref.make<Array<{ index: number; files: Array<typeof ExecuteFile.Type> }>>([])
      const calls = yield* Ref.make<Array<typeof ExecuteCall.Type>>([])
      const lock = Semaphore.makeUnsafe(1)
      const update = (change: (items: Array<typeof ExecuteCall.Type>) => Array<typeof ExecuteCall.Type>) =>
        lock.withPermit(
          Ref.updateAndGet(calls, change).pipe(Effect.flatMap((toolCalls) => context.progress({ toolCalls }))),
        )
      const result = yield* runtime(
        inventory,
        (name, tool, input) =>
          Effect.gen(function* () {
            const index = yield* Ref.getAndUpdate(callIndex, (value) => value + 1)
            const executed = yield* executeTool(name, tool, input, context)
            const content =
              typeof executed.content === "string"
                ? [{ type: "text" as const, text: executed.content }]
                : (executed.content ?? [])
            const outputFiles = content.flatMap((part) => {
              if (part.type !== "file") return []
              const prefix = `data:${part.mime};base64,`
              return part.uri.startsWith(prefix)
                ? [
                    {
                      data: part.uri.slice(prefix.length),
                      mime: part.mime,
                      ...(part.name === undefined ? {} : { name: part.name }),
                    },
                  ]
                : []
            })
            if (outputFiles.length > 0) yield* Ref.update(files, (items) => [...items, { index, files: outputFiles }])
            if (executed.output !== undefined) return executed.output
            const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
            return text === "" ? null : text
          }),
        {
          onToolCallStart: ({ index, name, input }) => {
            const shown = displayInput(input)
            return update((items) => {
              const next = [...items]
              next[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
              return next
            })
          },
          onToolCallEnd: ({ index, name, input, outcome }) => {
            const shown = displayInput(input)
            return update((items) => {
              const next = [...items]
              next[index] = {
                ...(items[index] ?? { tool: name, ...(shown ? { input: shown } : {}) }),
                status: outcome === "success" ? "completed" : "error",
              }
              return next
            })
          },
        },
      ).execute(code)
      const toolCalls = yield* Ref.get(calls)
      const collected = (yield* Ref.get(files)).toSorted((a, b) => a.index - b.index).flatMap((item) => item.files)
      const output = formatResult(result)
      return {
        output: { output, toolCalls, files: collected, ...(result.ok ? {} : { error: true as const }) },
        content: [
          { type: "text", text: output },
          ...collected.map((file) => ({
            type: "file" as const,
            uri: `data:${file.mime};base64,${file.data}`,
            mime: file.mime,
            ...(file.name === undefined ? {} : { name: file.name }),
          })),
        ],
        metadata: { toolCalls, ...(result.ok ? {} : { error: true }) },
      }
    }),
})

export const catalog = (inventory: Inventory): CodeModeCatalog.Inventory => {
  const pinned = new Set(
    Array.from(inventory.tools.values())
      .filter((tool) => tool.options?.pinned)
      .map(path),
  )
  const root = { children: new Map() } as Node<CodeModeCatalog.Tool>
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const tool of runtime(inventory, () => Effect.fail(toolError("Execute context is unavailable"))).catalog()) {
    getNode(root, tool.path).tool = {
      type: "tool",
      name: tool.path.split(".").at(-1) ?? tool.path,
      description: tool.description,
      signature: tool.signature,
      pinned: pinned.has(tool.path),
    }
  }
  return { tools: renderCatalog(root) }
}

function runtime(
  inventory: Inventory,
  execute: (name: string, tool: SchemaTool.Info, input: unknown) => Effect.Effect<unknown, unknown>,
  hooks?: CodeMode.ToolCallHooks,
) {
  const root = { children: new Map() } as Node<Tool.Tool<never>>
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const [name, registration] of inventory.tools) {
    const definition = inventory.definition(registration)
    getNode(root, path(registration)).tool = Tool.make({
      description: definition.description,
      input: definition.inputSchema,
      output: definition.outputSchema ?? Schema.NullOr(Schema.String),
      execute: (input) => execute(name, registration, input),
    })
  }
  const callables = new Map<string, Tool.Tool<never>>()
  const tools = renderChildren(root, [], callables)
  for (const [path, tool] of callables) tools[path] = tool
  return CodeMode.make<typeof tools>({ tools, ...hooks })
}

function getNode<T>(root: Node<T>, path: string) {
  return path.split(".").reduce((parent, name) => {
    const child = parent.children.get(name) ?? { children: new Map() } as Node<T>
    parent.children.set(name, child)
    return child
  }, root)
}

function renderCatalog(
  root: Node<CodeModeCatalog.Tool>,
): ReadonlyArray<CodeModeCatalog.Tool | CodeModeCatalog.Namespace> {
  return Array.from(root.children)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([name, node]) => {
      const tools = renderCatalog(node)
      const namespace =
        node.namespace === undefined && tools.length === 0
          ? undefined
          : {
              type: "namespace" as const,
              name,
              ...(node.namespace?.description === undefined ? {} : { description: node.namespace.description }),
              tools,
            }
      if (node.tool === undefined) return namespace === undefined ? [] : [namespace]
      return namespace === undefined ? [node.tool] : [node.tool, namespace]
    })
}

function renderChildren(
  node: Node<Tool.Tool<never>>,
  path: ReadonlyArray<string>,
  callables: Map<string, Tool.Tool<never>>,
): Tools {
  return Object.fromEntries(
    Array.from(node.children).flatMap(([name, child]) => {
      const next = [...path, name]
      if (path.length === 0 && child.tool !== undefined && (child.namespace !== undefined || child.children.size > 0)) {
        const tools: Tools = {}
        flattenTools(child, next, tools)
        return Object.entries(tools)
      }
      const tools = renderChildren(child, next, callables)
      if (child.tool !== undefined && (child.namespace !== undefined || child.children.size > 0))
        callables.set(next.join("."), child.tool)
      const entry =
        child.namespace !== undefined || child.tool === undefined || child.children.size > 0
          ? Namespace.make({
              ...(child.namespace?.description === undefined ? {} : { description: child.namespace.description }),
              tools,
            })
          : child.tool
      return [[name, entry]]
    }),
  )
}

function flattenTools(node: Node<Tool.Tool<never>>, path: ReadonlyArray<string>, tools: Tools) {
  if (node.tool !== undefined) tools[path.join(".")] = node.tool
  for (const [name, child] of node.children) flattenTools(child, [...path, name], tools)
}

/** Canonical callable path used by Code Mode catalogs and execution. */
export const path = (tool: Pick<SchemaTool.Info, "name" | "options">) =>
  tool.options?.namespace === undefined
    ? tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
    : `${tool.options.namespace}.${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`
function displayInput(input: unknown): Record<string, Schema.Json> | undefined {
  if (input === null || input === undefined) return
  if (typeof input !== "object" || Array.isArray(input)) return { input: input as Schema.Json }
  if (Object.keys(input).length === 0) return
  return input as Record<string, Schema.Json>
}

function formatResult(result: CodeMode.Result) {
  const output = result.ok
    ? formatValue(result.value)
    : [result.error.message, ...(result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))]
        .join("\n")
        .trim()
  const warnings =
    result.ok && result.warnings && result.warnings.length > 0
      ? `Warnings:\n${result.warnings.map((item) => `- [${item.kind}] ${item.message}`).join("\n")}`
      : undefined
  const logs = result.logs && result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : undefined
  return [output, warnings, logs].filter((part) => part !== undefined && part !== "").join("\n\n")
}

function formatValue(value: CodeMode.DataValue) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2) ?? String(value)
}
