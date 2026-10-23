import { AgentEvent } from "@bymorning/schema/agent-event"
import { expect, test } from "vitest"

test("declares the exact durable Agent lifecycle inventory", () => {
  expect(AgentEvent.Definitions).toEqual([AgentEvent.Created, AgentEvent.Updated, AgentEvent.Deleted])
})
