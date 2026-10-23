import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CodeModeCatalog } from "../../src/codemode/catalog.js"
import { CodeModeInstruction } from "../../src/codemode/instruction.js"
import { Instruction } from "../../src/instruction.js"

const entry = (path: string, description: string) => ({
  type: "tool" as const,
  name: path,
  description,
  signature: `tools.${path}(): Promise<void>`,
})

describe("CodeModeInstruction", () => {
  it("replaces the catalog when a namespace description changes", () => {
    const inventory = (description: string): CodeModeCatalog.Inventory => ({
      tools: [
        {
          type: "namespace",
          name: "notes",
          description,
          tools: [{ type: "tool", name: "echo", description: "Echo", signature: "tools.notes.echo(): Promise<void>" }],
        },
      ],
    })
    const previous = CodeModeCatalog.summarize(inventory("Old description"))
    const current = CodeModeCatalog.summarize(inventory("New description"))
    expect(CodeModeInstruction.render(current)).toContain("New description")
    expect(CodeModeInstruction.update(previous, current)).toContain("supersedes the previous Code Mode tool catalog")
  })
  it("instructs the model not to call execute while the catalog is empty", () => {
    const empty = CodeModeCatalog.summarize({ tools: [] })
    expect(CodeModeInstruction.render(empty)).toBe(
      "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
    expect(
      CodeModeInstruction.update(CodeModeCatalog.summarize({ tools: [entry("notes.echo", "Echo text")] }), empty),
    ).toBe(
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n" +
        "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })

  it("renders the initial catalog and semantic complete-catalog deltas", () => {
    const echo = entry("notes.echo", "Echo text")
    const lookup = entry("orders.lookup", "Look up an order")
    const initial = CodeModeCatalog.summarize({ tools: [echo] })
    const added = CodeModeCatalog.summarize({ tools: [echo, lookup] })

    expect(CodeModeInstruction.render(initial)).toContain(
      "This catalog is the complete set of tools available within Code Mode.",
    )
    expect(CodeModeInstruction.render(initial)).not.toContain("## Search")
    expect(CodeModeInstruction.update(initial, added)).toContain("New tools are available")
    expect(CodeModeInstruction.update(added, initial)).toBe(
      "The Code Mode tool catalog has changed.\n\n" +
        "The following tools are no longer available and must not be called: tools.orders.lookup.",
    )
  })

  it("renders searchable partial inventory deltas and replaces completeness transitions", () => {
    const previous: CodeModeCatalog.Summary = {
      total: 2,
      shown: 0,
      namespaces: [{ name: "notes", count: 2, entries: [] }],
    }
    const current: CodeModeCatalog.Summary = {
      total: 3,
      shown: 0,
      namespaces: [{ name: "notes", count: 3, entries: [] }],
    }
    const complete = CodeModeCatalog.summarize({ tools: [entry("notes.echo", "Echo text")] })

    expect(CodeModeInstruction.update(previous, current)).toContain("search them again")
    expect(CodeModeInstruction.update(previous, complete)).toContain("supersedes the previous Code Mode tool catalog")
  })

  it.effect("uses the durable core/codemode key and confirms removal", () =>
    Effect.gen(function* () {
      const [present] = CodeModeInstruction.make({ tools: [entry("notes.echo", "Echo text")] })
      const [removed] = CodeModeInstruction.make()
      expect(present.key).toBe(Instruction.Key.make("core/codemode"))
      expect(yield* removed.read).toBe(Instruction.removed)
      expect(present.removed(CodeModeCatalog.summarize({ tools: [] }))).toBe(
        "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      )
    }),
  )
})
