import { AgentSchema } from "@bymorning/schema/agent"
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"
import { seedBuiltIn } from "./built-in.js"

const instructions = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run shell commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

export const ExploreAgentPlugin = define({
  id: "core.agent.explore",
  effect: (context) =>
    Effect.asVoid(
      context.agent.transform((editor) =>
        seedBuiltIn(editor, AgentSchema.ExploreID, {
          name: "Explore",
          description:
            'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
          instructions,
          mode: "subagent",
          hidden: false,
          steps: null,
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "execute", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "webfetch", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "subagent", resource: "*", effect: "deny" },
            { action: "external_directory", resource: "*", effect: "ask" },
          ],
        }),
      ),
    ),
})
