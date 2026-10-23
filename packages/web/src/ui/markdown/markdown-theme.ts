import type { ThemeRegistrationRaw } from "shiki"

export const ByMorningTheme: ThemeRegistrationRaw = {
  name: "ByMorning",
  bg: "var(--color-bg-layer-2)",
  fg: "var(--color-text-base)",
  colors: {
    "editor.background": "var(--color-bg-layer-2)",
    "editor.foreground": "var(--color-text-base)",
  },
  settings: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "var(--color-text-muted)" } },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.operator"],
      settings: { foreground: "var(--color-purple-700)" },
    },
    {
      scope: ["string", "punctuation.definition.string", "entity.name.tag"],
      settings: { foreground: "var(--color-green-700)" },
    },
    {
      scope: ["constant", "variable.language", "support.constant"],
      settings: { foreground: "var(--color-orange-700)" },
    },
    {
      scope: ["entity.name.function", "support.function", "support.type"],
      settings: { foreground: "var(--color-blue-700)" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class"],
      settings: { foreground: "var(--color-cyan-700)" },
    },
    { scope: ["variable", "meta.object.member"], settings: { foreground: "var(--color-text-base)" } },
    { scope: ["invalid", "message.error"], settings: { foreground: "var(--color-red-700)" } },
    { scope: "markup.bold", settings: { fontStyle: "bold", foreground: "var(--color-text-base)" } },
    { scope: "markup.italic", settings: { fontStyle: "italic" } },
  ],
}
