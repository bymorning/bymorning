/** Exposes outbound MCP server guidance as a durable Instruction source. */
export * as OutboundMCPInstruction from "./outbound-mcp-instruction.js"

import { Effect, Schema } from "effect"
import { Instruction } from "./instruction.js"
import { Mcp } from "./mcp.js"
import { CodeModeTool } from "./codemode/tool.js"

const Summary = Schema.Struct({
  server: Schema.String,
  instructions: Schema.String,
  codemode: Schema.optionalKey(Schema.Literal(false)),
})
type Summary = typeof Summary.Type

const entries = (servers: ReadonlyArray<Summary>) =>
  servers.flatMap((server) => {
    const result = [`  <server name="${server.server}">`]
    if (server.codemode !== false)
      result.push(
        `    Use tools from this server through \`execute\` under \`tools[${JSON.stringify(CodeModeTool.path({ name: server.server }))}]\`.`,
      )
    result.push(...server.instructions.split("\n").map((line) => `    ${line}`), "  </server>")
    return result
  })

const render = (servers: ReadonlyArray<Summary>) =>
  ["<mcp_instructions>", ...entries(servers), "</mcp_instructions>"].join("\n")

const update = (previous: ReadonlyArray<Summary>, current: ReadonlyArray<Summary>) => {
  const diff = Instruction.diffByKey(
    previous,
    current,
    (server) => server.server,
    (before, after) => before.instructions !== after.instructions || before.codemode !== after.codemode,
  )
  if (diff.changed.length > 0 || (diff.added.length === 0 && diff.removed.length === 0))
    return [
      "The available MCP server instructions have changed. This list supersedes the previous one.",
      render(current),
    ].join("\n")
  return [
    ...(diff.added.length === 0
      ? []
      : ["New MCP server instructions are available in addition to those previously listed:", ...entries(diff.added)]),
    ...(diff.removed.length === 0
      ? []
      : [
          `Instructions for the following MCP servers are no longer available: ${diff.removed.map((server) => server.server).join(", ")}.`,
        ]),
  ].join("\n")
}

export const load = Effect.fn("OutboundMCPInstruction.load")(function* (input: {
  readonly mcp: Mcp.Interface
  readonly permitted: ReadonlySet<string>
  readonly codeModeEnabled: boolean
}) {
  const visible = (yield* input.mcp.instructions())
    .flatMap((item) => {
      if (item.codemode && !input.codeModeEnabled) return []
       return [
        item.codemode
          ? { server: item.server, instructions: item.instructions }
          : { server: item.server, instructions: item.instructions, codemode: false as const },
      ]
    })
    .toSorted((a, b) => a.server.localeCompare(b.server))
  const authorization = (yield* input.mcp.servers())
    .filter((server) => server.enabled && (server.status === "disabled" || server.status === "needs_auth"))
    .filter(() => input.permitted.has("mcp_connect"))
    .map((server) => ({
      server: server.name,
      instructions: input.codeModeEnabled
          ? `This configured server is not connected. Use \`execute\` to call \`tools.toolkit.mcp.connect({ server: ${JSON.stringify(server.name)} })\` before using its tools.`
          : `This configured server is not connected before its tools are available.`,
      ...(input.codeModeEnabled ? {} : { codemode: false as const }),
    }))
  visible.push(...authorization)
  visible.sort((a, b) => a.server.localeCompare(b.server))
  return Instruction.make<ReadonlyArray<Summary>>({
    key: Instruction.Key.make("core/mcp-guidance"),
    codec: Schema.toCodecJson(Schema.Array(Summary)),
    read: Effect.succeed(visible.length === 0 ? Instruction.removed : visible),
    render: {
      initial: render,
      changed: update,
      removed: () => "MCP server instructions are no longer available.",
    },
  })
})
