import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { MessageSchema } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { empty } from "@bymorning/schema/usage"
import { SessionMessage } from "../../src/session/message.js"

const base = {
  id: MessageSchema.ID.make("00000000-0000-4000-8000-000000000901"),
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000902"),
  sequence: 1,
  createdAt: new Date(0),
  type: "assistant" as const,
  agent: Agent.ID.make("general"),
  model: { provider: Provider.Bymorning, id: "model" },
  finish: "unknown" as const,
  time: { created: new Date(0), completed: new Date(1) },
  usage: empty,
}

describe("SessionMessage.continues", () => {
  it("stops a completed unknown-finish text response", () => {
    expect(
      SessionMessage.continues(
        MessageSchema.Assistant.make({
          ...base,
          content: [{ type: "text", id: "text", text: "Why did the chicken cross the road?" }],
        }),
      ),
    ).toBe(false)
  })

  it("continues an empty unknown-finish response or a settled tool call", () => {
    expect(SessionMessage.continues(MessageSchema.Assistant.make({ ...base, content: [] }))).toBe(true)
    expect(
      SessionMessage.continues(
        MessageSchema.Assistant.make({
          ...base,
          content: [
            {
              type: "tool",
              id: "tool",
              name: "read",
              state: { status: "completed", input: {}, content: [] },
              time: { created: new Date(0), completed: new Date(1) },
            },
          ],
        }),
      ),
    ).toBe(true)
  })
})
