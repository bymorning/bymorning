import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"

// These servers provide Code Mode, so expose them directly instead of nesting them inside ByMorning Code Mode.
const urls = [/^https:\/\/executor\.sh\/[^/]+\/mcp$/]

export const McpCodeModeExclusionPlugin = define({
  id: "bymorning.mcp.codemode.exclusion",
  effect: Effect.fn(function* (context) {
    yield* context.mcp.transform((editor) => {
      for (const [, server] of editor.list()) {
        if (server.codemode !== undefined || !URL.canParse(server.url)) continue
        const url = new URL(server.url)
        const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`
        if (urls.some((pattern) => pattern.test(endpoint))) server.codemode = false
      }
    })
  }),
})
