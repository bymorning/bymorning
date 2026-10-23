import { AgentSchema } from "@bymorning/schema/agent"
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"
import { seedBuiltIn } from "./built-in.js"

export const GeneralAgentPlugin = define({
  id: "core.agent.general",
  effect: (context) =>
    Effect.asVoid(
      context.agent.transform((editor) =>
        seedBuiltIn(editor, AgentSchema.GeneralID, {
          name: "General",
          description:
            "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
          instructions: "",
          mode: "subagent",
          hidden: false,
          steps: null,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          ],
        }),
      ),
    ),
})
