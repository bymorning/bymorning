import { Tool } from "@bymorning/plugin"
import { describe, expect, test } from "vitest"
import plugin from "../src/tool-guard.js"

type Hook = (input: never) => unknown

async function activate(options: Readonly<Record<string, unknown>> = {}) {
  const hooks = new Map<string, Hook>()
  await plugin.setup({
    options,
    tool: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`tool.${name}`, callback)
        return { dispose: async () => undefined }
      },
    },
    gateway: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`gateway.${name}`, callback)
        return { dispose: async () => undefined }
      },
    },
  } as unknown as Parameters<typeof plugin.setup>[0])
  return {
    invoke: async (name: string, input: unknown) => {
      const callback = hooks.get(name)
      if (callback === undefined) throw new Error(`${name} was not registered`)
      return await callback(input as never)
    },
  }
}

describe("tool-guard example", () => {
  test("blocks a matching shell command", async () => {
    const hooks = await activate({ tool: "shell", substring: "rm -rf" })
    const result = await hooks.invoke("tool.execute.before", {
      tool: "shell",
      input: { command: "rm -rf /" },
    })
    expect(result).toBeInstanceOf(Tool.Error)
  })

  test("admits a non-matching command", async () => {
    const hooks = await activate({ tool: "shell", substring: "rm -rf" })
    await expect(
      hooks.invoke("tool.execute.before", { tool: "shell", input: { command: "ls" } }),
    ).resolves.toBeUndefined()
  })

  test("ignores a Tool that does not match the name pattern", async () => {
    const hooks = await activate({ tool: "shell", substring: "rm -rf" })
    await expect(
      hooks.invoke("gateway.tool.execute.before", { tool: "read", input: { path: "rm -rf notes" } }),
    ).resolves.toBeUndefined()
  })
})
