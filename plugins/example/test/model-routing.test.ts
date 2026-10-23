import { Provider } from "@bymorning/schema/provider"
import { describe, expect, test } from "vitest"
import plugin from "../src/model-routing.js"

type Hook = (input: never) => unknown

async function activate(options: Readonly<Record<string, unknown>>) {
  // This local example unit fixture captures the registered callbacks; it is
  // intentionally not an application-coverage substitute.
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

const ref = (provider: string, id: string, variant?: string) => ({
  provider: Provider.Name.make(provider),
  id,
  ...(variant === undefined ? {} : { variant }),
})

describe("model-routing example", () => {
  test("routes matching Session and Gateway requests to the configured target", async () => {
    const hooks = await activate({
      requested: "requested-provider/requested-model",
      target: "approved-provider/approved-model",
    })
    const session = {
      purpose: "assistant" as const,
      requestedModel: ref("requested-provider", "requested-model"),
      model: ref("requested-provider", "requested-model"),
      headers: {},
    }
    const gateway = {
      protocol: "openai-chat" as const,
      requestedModel: "requested-provider/requested-model",
      stream: false,
      model: "requested-provider/requested-model",
      body: { model: "requested-provider/requested-model" },
    }

    await hooks.invoke("session.model.request", session)
    await hooks.invoke("gateway.model.request", gateway)

    expect(plugin.scope).toBe("workspace")
    expect(session.model).toEqual(ref("approved-provider", "approved-model"))
    expect(gateway.model).toBe("approved-provider/approved-model")
    expect(gateway.body.model).toBe("requested-provider/requested-model")
  })

  test("routes a wildcard requested pattern", async () => {
    const hooks = await activate({
      requested: "requested-provider/*",
      target: "approved-provider/approved-model",
    })
    const session = {
      requestedModel: ref("requested-provider", "any-model", "fast"),
      model: ref("requested-provider", "any-model", "fast"),
    }
    const gateway = {
      requestedModel: "requested-provider/any-model#fast",
      model: "requested-provider/any-model#fast",
    }

    await hooks.invoke("session.model.request", session)
    await hooks.invoke("gateway.model.request", gateway)

    expect(session.model).toEqual(ref("approved-provider", "approved-model"))
    expect(gateway.model).toBe("approved-provider/approved-model")
  })

  test("leaves non-matching requests unchanged", async () => {
    const hooks = await activate({
      requested: "requested-provider/requested-model",
      target: "approved-provider/approved-model",
    })
    const session = {
      requestedModel: ref("other-provider", "other-model"),
      model: ref("other-provider", "other-model"),
    }
    const gateway = {
      requestedModel: "other-provider/other-model",
      model: "other-provider/other-model",
    }

    await hooks.invoke("session.model.request", session)
    await hooks.invoke("gateway.model.request", gateway)

    expect(session.model).toEqual(ref("other-provider", "other-model"))
    expect(gateway.model).toBe("other-provider/other-model")
  })

  test.each([
    {},
    { requested: "requested-provider/requested-model" },
    { requested: "requested-provider/*", target: "approved-provider/*" },
    { requested: "prv_x/model", target: "approved-provider/approved-model" },
    { requested: "requested-provider/requested-model", target: "approved provider/approved-model" },
  ])("rejects invalid options %#", async (options) => {
    await expect(activate(options)).rejects.toThrow("Model route configuration is invalid")
  })
})
