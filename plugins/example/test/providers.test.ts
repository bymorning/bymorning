import { ModelError } from "@bymorning/plugin"
import { Provider } from "@bymorning/schema/provider"
import { describe, expect, test } from "vitest"
import plugin from "../src/providers.js"

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
  } as unknown as Parameters<typeof plugin.setup>[0])
  return {
    invoke: async (name: string, input: unknown) => {
      const callback = hooks.get(name)
      if (callback === undefined) throw new Error(`${name} was not registered`)
      return await callback(input as never)
    },
  }
}

const model = (provider: string) => ({ provider: Provider.Name.make(provider), id: "model" })

describe("providers example", () => {
  test("admits every Provider when the list is empty", async () => {
    const hooks = await activate({ allowed: "" })
    await expect(hooks.invoke("session.model.invoke", { model: model("openai") })).resolves.toBeUndefined()
  })

  test("denies a Provider missing from the list", async () => {
    const hooks = await activate({ allowed: "anthropic" })
    const result = await hooks.invoke("session.model.invoke", { model: model("openai") })
    expect(result).toBeInstanceOf(ModelError)
    expect(result).toMatchObject({ reason: "denied" })
  })

  test("admits a listed Provider", async () => {
    const hooks = await activate({ allowed: "anthropic, openai" })
    await expect(hooks.invoke("gateway.model.invoke", { model: model("openai") })).resolves.toBeUndefined()
  })
})
