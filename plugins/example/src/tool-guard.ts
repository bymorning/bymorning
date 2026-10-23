import { Plugin, Tool } from "@bymorning/plugin"

const options = (value: Readonly<Record<string, unknown>>) => {
  const tool = typeof value.tool === "string" && value.tool.length > 0 ? value.tool : "*"
  const substring = typeof value.substring === "string" ? value.substring : "rm -rf"
  if (tool.includes("/")) throw new Error('Tool guard option "tool" cannot contain "/"')
  return { tool, substring }
}

const matchTool = (name: string, pattern: string) => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`).test(name)
}

/** Denies matching Session and Gateway Tool calls whose serialized input contains a substring. */
export default Plugin.define({
  id: "example.tool-guard",
  scope: "workspace",
  configuration: {
    title: "Tool input guard",
    description:
      "Refuse Tool calls whose name matches a pattern and whose JSON input contains a substring. Permanent Tool policy still belongs in Workspace permissions.",
    fields: [
      {
        key: "tool",
        type: "string",
        title: "Tool name pattern",
        description: "Whole-string pattern with * and ?. Example: shell or *_write.",
        default: "*",
        required: true,
      },
      {
        key: "substring",
        type: "string",
        title: "Blocked input substring",
        description: "Refuse when this literal appears in the JSON-serialized Tool input.",
        default: "rm -rf",
      },
    ],
  },
  async setup(context) {
    const { tool, substring } = options(context.options)
    const before = (input: { tool: string; input: unknown }) => {
      if (substring.length === 0) return
      if (!matchTool(input.tool, tool)) return
      if (!JSON.stringify(input.input).includes(substring)) return
      return new Tool.Error({ message: "This Tool input is blocked by company policy." })
    }
    await Promise.all([
      context.tool.hook("execute.before", before),
      context.gateway.hook("tool.execute.before", before),
    ])
  },
})
