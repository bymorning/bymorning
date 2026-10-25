import { describe, expect, test } from "vitest"
import plugin from "../src/redaction.js"

type Hook = (input: never) => unknown

async function activate(options: Readonly<Record<string, unknown>> = {}) {
  const hooks = new Map<string, Hook>()
  await plugin.setup({
    options,
    session: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`session.${name}`, callback)
        return { dispose: async () => undefined }
      },
    },
    gateway: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`gateway.${name}`, callback)
        return { dispose: async () => undefined }
      },
    },
    tool: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`tool.${name}`, callback)
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

describe("redaction example", () => {
  test("redacts Session prompt text", async () => {
    const hooks = await activate()
    const input = { prompt: { text: "ssn 123-45-6789 email ada@example.com key sk-abcdefghijk" } }
    await hooks.invoke("session.prompt", input)
    expect(input.prompt.text).toBe("ssn [SSN] email [EMAIL] key [SECRET]")
  })

  test("redacts nested Gateway body strings", async () => {
    const hooks = await activate()
    const request = {
      body: { messages: [{ content: "call 123-45-6789" }] },
    }
    await hooks.invoke("gateway.model.request", request)
    expect(request.body.messages[0]?.content).toBe("call [SSN]")
  })

  test("skips hooks when disabled", async () => {
    const hooks = new Map<string, Hook>()
    await plugin.setup({
      options: { enabled: false },
      session: { hook: async (name: string, callback: Hook) => {
        hooks.set(name, callback)
        return { dispose: async () => undefined }
      } },
      gateway: { hook: async () => ({ dispose: async () => undefined }) },
      tool: { hook: async () => ({ dispose: async () => undefined }) },
    } as unknown as Parameters<typeof plugin.setup>[0])
    expect(hooks.size).toBe(0)
  })
})
