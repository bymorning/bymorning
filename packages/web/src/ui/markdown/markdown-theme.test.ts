import { createHighlighter } from "shiki"
import { describe, expect, it } from "vitest"

import { ByMorningTheme } from "./markdown-theme"

describe("ByMorningTheme", () => {
  it("applies syntax colors to code tokens", async () => {
    const highlighter = await createHighlighter({ themes: [ByMorningTheme], langs: ["ts"] })
    const tokens = highlighter.codeToTokens("const greeting = 'hello'", { lang: "ts", theme: "ByMorning" }).tokens.flat()

    expect(tokens.find((token) => token.content === "const")?.color).toBe("var(--color-purple-700)")
    expect(tokens.find((token) => token.content === "'hello'")?.color).toBe("var(--color-green-700)")
    highlighter.dispose()
  })
})
