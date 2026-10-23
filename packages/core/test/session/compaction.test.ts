import { CompactionCompleted, ID, User } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import type { Usage } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { Crypto, Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Config } from "../../src/config.js"
import { ModelResolver } from "../../src/model-resolver.js"
import { Permission } from "../../src/permission.js"
import { PluginHooks } from "../../src/plugin/hooks.js"
import { Provider } from "../../src/provider.js"
import { buildPrompt, make, type RequiredInput } from "../../src/session/compaction.js"
import { fromHistory } from "../../src/session/provider-message.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000701")

describe("Session compaction", () => {
  it("requires the frozen checkpoint sections in order", () => {
    const prompt = buildPrompt({ context: ["conversation"] })
    expect(prompt.match(/^#{2,3} .+$/gm)).toEqual([
      "## Objective",
      "## Important Details",
      "## Work State",
      "### Completed",
      "### Active",
      "### Blocked",
      "## Next Move",
      "## Relevant Files",
    ])
  })

  it("lowers a completed checkpoint to one user message", () => {
    const checkpoint = CompactionCompleted.make({
      id: ID.make("00000000-0000-4000-8000-000000000702"),
      sessionID,
      sequence: 2,
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "summary",
      recent: "recent",
      createdAt: new Date(0),
    })
    const history = fromHistory([
      User.make({
        id: ID.make("00000000-0000-4000-8000-000000000703"),
        sessionID,
        sequence: 1,
        type: "user",
        text: "old",
        admittedSequence: 1,
        createdAt: new Date(0),
      }),
      checkpoint,
    ])
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history[1])).toContain("<conversation-checkpoint>\\nsummary\\n\\nrecent")
  })

  describe("automatic threshold", () => {
    const required = (messages: readonly unknown[], limit = { context: 200_000, output: 32_000 }) =>
      make({} as never, {} as never, Workspace.ID.make("wrk_compaction_threshold")).pipe(
        Effect.map((compaction) =>
          compaction.required({
            messages: messages as RequiredInput["messages"],
            model: { info: { limit } } as unknown as RequiredInput["model"],
          }),
        ),
        Effect.provideService(Config.Service, {
          get: Effect.succeed({ compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } } }),
        } as never),
        Effect.provideService(Crypto.Crypto, {} as never),
        Effect.provideService(Provider.Service, {} as never),
        Effect.provideService(PluginHooks.Service, {} as never),
        Effect.provideService(Permission.Service, {} as never),
        Effect.provideService(ModelResolver.Service, {} as never),
        Effect.runSync,
      )
    const assistant = (input: number, read = 0, output = 0) => ({
      type: "assistant",
      time: { created: new Date(0), completed: new Date(1) },
      usage: {
        cost: 0,
        costComplete: true,
        tokens: { input, output, reasoning: 0, cache: { read, write: 0 } },
      } satisfies Usage,
    })

    // Ceiling: 200_000 context - max(min(32_000, 32_000), 20_000 buffer) = 168_000.
    it("measures the latest execution's prompt including cached input and output", () => {
      expect(required([assistant(1_000, 160_000, 6_999)])).toBe(false)
      expect(required([assistant(1_000, 160_000, 7_000)])).toBe(true)
    })

    it("does not add earlier executions together", () => {
      expect(required([assistant(100_000), assistant(100_000)])).toBe(false)
    })

    it("ignores a later execution that recorded no usage", () => {
      expect(required([assistant(170_000), assistant(0)])).toBe(true)
    })
  })
})
