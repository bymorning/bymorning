import { Agent } from "@bymorning/schema/agent"
import { describe, expect, it } from "vitest"

import { presentBackground } from "./background-presenter"

const childID = "00000000-0000-4000-8000-000000000002"

describe("background presentation", () => {
  it("reconciles Shell and Subagent generations and scopes blockers to the latest execution", () => {
    const result = presentBackground({
      transcript: {
        state: "ready",
        data: [
          {
            message: {
              type: "synthetic",
              metadata: {
                source: "subagent",
                childID,
                state: "completed",
                startedAt: 1,
              },
            },
          },
          {
            message: {
              id: "older",
              type: "assistant",
              sequence: 1,
              time: {},
              content: [{ type: "tool", id: "old", name: "shell", state: { status: "running", input: {} } }],
            },
          },
          {
            message: {
              id: "latest",
              type: "assistant",
              sequence: 2,
              time: {},
              content: [
                { type: "tool", id: "blocking-shell", name: "shell", state: { status: "running", input: {} } },
                {
                  type: "tool",
                  id: "subagent-old-generation",
                  name: "subagent",
                  state: {
                    status: "completed",
                    input: { agent: "explore", description: "Old generation" },
                    metadata: { sessionID: childID, status: "running", startedAt: 1 },
                  },
                },
                {
                  type: "tool",
                  id: "subagent-new-generation",
                  name: "subagent",
                  state: {
                    status: "completed",
                    input: { agent: "explore", description: "Map ownership" },
                    metadata: { sessionID: childID, status: "running", startedAt: 2 },
                  },
                },
                {
                  type: "tool",
                  id: "shell-active",
                  name: "shell",
                  state: {
                    status: "completed",
                    input: { command: "bun test" },
                    metadata: { shellID: "shell-active", status: "running", startedAt: 3 },
                  },
                },
              ],
            },
          },
        ],
      } as never,
      agents: [{ id: Agent.ID.make("explore"), name: "Explore", color: "#abc" }] as never,
    })

    expect(result.blocking).toEqual(["blocking-shell"])
    expect(result.active).toEqual([
      {
        id: `subagent:${childID}:2`,
        kind: "subagent",
        title: "Explore",
        description: "Map ownership",
        sessionID: childID,
        color: "#abc",
      },
      { id: "shell:shell-active:3", kind: "shell", description: "bun test" },
    ])
  })

  it("deduplicates one generation and removes it only for its matching terminal synthetic", () => {
    const tool = {
      type: "tool",
      id: "same",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "echo hi" },
        metadata: { shellID: "same", status: "running", startedAt: 4 },
      },
    }
    const result = presentBackground({
      transcript: {
        state: "ready",
        data: [
          {
            message: {
              type: "synthetic",
              metadata: { source: "shell", shellID: "same", state: "completed", startedAt: 4 },
            },
          },
          { message: { type: "assistant", time: { completed: 5 }, content: [tool, { ...tool, id: "same-again" }] } },
        ],
      } as never,
      agents: [],
    })
    expect(result.active).toHaveLength(0)
  })
})
