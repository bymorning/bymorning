import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Instruction } from "../src/instruction.js"
import { Mcp } from "../src/mcp.js"
import { OutboundMCPInstruction } from "../src/outbound-mcp-instruction.js"

type ServerInstruction = Effect.Success<ReturnType<Mcp.Interface["instructions"]>>[number]

const coordinator = (catalog: () => ReadonlyArray<ServerInstruction>, servers: () => ReadonlyArray<Mcp.Server> = () => []) =>
  ({
    instructions: () => Effect.succeed(catalog()),
    servers: () => Effect.succeed(servers()),
    authorize: () => Effect.die("unused"),
    connect: () => Effect.die("unused"),
    disconnect: () => Effect.die("unused"),
    test: () => Effect.die("unused"),
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    tools: () => Effect.die("unused"),
    callTool: () => Effect.die("unused"),
  }) satisfies Mcp.Interface

const load = (
  catalog: () => ReadonlyArray<ServerInstruction>,
  permitted: ReadonlySet<string>,
  codeModeEnabled = true,
  servers?: () => ReadonlyArray<Mcp.Server>,
) => OutboundMCPInstruction.load({ mcp: coordinator(catalog, servers), permitted, codeModeEnabled })

describe("OutboundMCPInstruction", () => {
  it.effect("sorts servers and renders current server guidance", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(
        yield* load(
          () => [
            { server: "beta", instructions: "Beta instructions", codemode: true },
            { server: "hidden", instructions: "Hidden instructions", codemode: true },
            {
              server: "alpha server",
              instructions: "Alpha line one\nAlpha line two",
              codemode: true,
              tools: ["alpha_server_search", "alpha_server_restricted"],
            },
          ],
          new Set(["alpha_server_search", "beta_search"]),
        ),
      )

      expect(initialized.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="alpha server">',
          '    Use tools from this server through `execute` under `tools["alpha_server"]`.',
          "    Alpha line one",
          "    Alpha line two",
          "  </server>",
          '  <server name="beta">',
           '    Use tools from this server through `execute` under `tools["beta"]`.',
           "    Beta instructions",
           "  </server>",
           '  <server name="hidden">',
           '    Use tools from this server through `execute` under `tools["hidden"]`.',
           "    Hidden instructions",
           "  </server>",
           "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("hides Code Mode servers when Code Mode is disabled but keeps direct servers", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(
        yield* load(
          () => [
            { server: "codemode", instructions: "Code Mode instructions", codemode: true },
            { server: "direct", instructions: "Direct instructions", codemode: false },
          ],
          new Set(["codemode_search", "direct_search"]),
          false,
        ),
      )

      expect(initialized.text).toBe(
        [
          "<mcp_instructions>",
          '  <server name="direct">',
          "    Direct instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("guides an available Code Mode connection for a disabled configured server", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(
        yield* load(
          () => [],
          new Set(["mcp_connect"]),
          true,
          () => [{ name: "jira", enabled: true, status: "disabled" }],
        ),
      )
      expect(initialized.text).toContain('tools.toolkit.mcp.connect({ server: "jira" })')

      const workspaceDisabled = yield* readInitial(
        yield* load(
          () => [],
          new Set(["mcp_connect"]),
          true,
          () => [{ name: "jira", enabled: false, status: "disabled" }],
        ),
      )
      expect(workspaceDisabled.text).toBe("")

      const unavailable = yield* readInitial(
        yield* load(() => [], new Set(), true, () => [{ name: "jira", enabled: true, status: "disabled" }]),
      )
      expect(unavailable.text).toBe("")
    }),
  )

  it.effect("renders additions, changes, and removals", () => {
    const beta = { server: "beta", instructions: "Beta instructions", codemode: true }
    let catalog: ReadonlyArray<ServerInstruction> = [
      { server: "alpha", instructions: "Alpha instructions", codemode: true },
    ]
    return Effect.gen(function* () {
      const sources = yield* load(() => catalog, new Set(["alpha_search", "beta_search"]))
      const initialized = yield* readInitial(sources)

      catalog = [
        ...catalog,
        beta,
      ]
      const added = yield* readUpdate(yield* load(() => catalog, new Set(["alpha_search", "beta_search"])), initialized)
      expect(added.text).toBe(
        [
          "New MCP server instructions are available in addition to those previously listed:",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
        ].join("\n"),
      )

      catalog = [
        { server: "alpha", instructions: "Updated alpha", codemode: true },
        beta,
      ]
      const changed = yield* readUpdate(yield* load(() => catalog, new Set(["alpha_search", "beta_search"])), added)
      expect(changed.text).toBe(
        [
          "The available MCP server instructions have changed. This list supersedes the previous one.",
          "<mcp_instructions>",
          '  <server name="alpha">',
          '    Use tools from this server through `execute` under `tools["alpha"]`.',
          "    Updated alpha",
          "  </server>",
          '  <server name="beta">',
          '    Use tools from this server through `execute` under `tools["beta"]`.',
          "    Beta instructions",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )

      catalog = [beta]
      const removed = yield* readUpdate(yield* load(() => catalog, new Set(["alpha_search", "beta_search"])), changed)
      expect(removed.text).toBe("Instructions for the following MCP servers are no longer available: alpha.")

      catalog = []
      expect((yield* readUpdate(yield* load(() => catalog, new Set(["beta_search"])), removed)).text).toBe(
        "MCP server instructions are no longer available.",
      )
    })
  })
})

const readInitial = Effect.fn("test.readInitial")(function* (sources: Instruction.List) {
  const source = sources[0]
  if (source === undefined) return yield* Effect.die("instruction source missing")
  const value = yield* source.read
  if (value === Instruction.removed || value === Instruction.unavailable) return { text: "", value: undefined }
  return { text: source.initial(value) ?? "", value }
})

const readUpdate = Effect.fn("test.readUpdate")(function* (
  sources: Instruction.List,
  previous: { readonly text: string; readonly value: Schema.Json | undefined },
) {
  const source = sources[0]
  if (source === undefined) return yield* Effect.die("instruction source missing")
  const value = yield* source.read
  if (value === Instruction.unavailable) return previous
  if (value === Instruction.removed)
    return { text: previous.value === undefined ? "" : (source.removed(previous.value) ?? ""), value: undefined }
  return {
    text: previous.value === undefined ? (source.initial(value) ?? "") : (source.changed(previous.value, value) ?? ""),
    value,
  }
})
