import { ModelError } from "@bymorning/plugin"
import { Provider } from "@bymorning/schema/provider"
import { describe, expect, test } from "vitest"
import plugin from "../src/company-policy.js"

type Hook = (input: never) => unknown

async function activate(options: Readonly<Record<string, unknown>> = {}) {
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

const model = (provider: string, id = "model") => ({
  provider: Provider.Name.make(provider),
  id,
})

describe("company-policy example", () => {
  // Without Workspace scope the Gateway hooks never run for caller-less inference (packages/plugin/AGENTS.md).
  test("declares Workspace scope so Gateway hooks are active", () => {
    expect(plugin.scope).toBe("workspace")
  })

  test("denies the restricted Provider on Session and Gateway model.invoke", async () => {
    const hooks = await activate({ restrictProvider: true })
    const session = await hooks.invoke("session.model.invoke", { model: model("restricted") })
    const gateway = await hooks.invoke("gateway.model.invoke", { model: model("restricted") })

    expect(session).toBeInstanceOf(ModelError)
    expect(session).toMatchObject({ reason: "denied", message: "This Provider is restricted by company policy." })
    expect(gateway).toBeInstanceOf(ModelError)
    expect(gateway).toMatchObject({ reason: "denied" })
  })

  test("admits an unrestricted Provider", async () => {
    const hooks = await activate({ restrictProvider: true })
    await expect(hooks.invoke("session.model.invoke", { model: model("openai") })).resolves.toBeUndefined()
    await expect(hooks.invoke("gateway.model.invoke", { model: model("openai") })).resolves.toBeUndefined()
  })

  test("skips Provider denial when restrictProvider is false", async () => {
    const hooks = await activate({ restrictProvider: false })
    await expect(hooks.invoke("session.model.invoke", { model: model("restricted") })).resolves.toBeUndefined()
    const request = {
      protocol: "openai-chat" as const,
      requestedModel: "restricted/model",
      stream: false,
      model: "restricted/model",
      body: { model: "restricted/model" },
    }
    await expect(hooks.invoke("gateway.model.request", request)).resolves.toBeUndefined()
  })

  test("denies a restricted Gateway model.request and redacts customer IDs", async () => {
    const hooks = await activate({ restrictProvider: true })
    const request = {
      protocol: "openai-chat" as const,
      requestedModel: "restricted/model",
      stream: false,
      model: "restricted/model",
      body: {
        model: "restricted/model",
        messages: [{ role: "user", content: "Customer CUST-12345678 and CUST-00000001 called" }],
      },
    }

    const result = await hooks.invoke("gateway.model.request", request)

    expect(result).toBeInstanceOf(ModelError)
    expect(result).toMatchObject({ reason: "denied" })
    expect(request.body.messages[0]?.content).toBe("Customer CUST-[redacted] and CUST-[redacted] called")
  })

  test("redacts nested Gateway request strings without refusing other Providers", async () => {
    const hooks = await activate({ restrictProvider: true })
    const request = {
      protocol: "openai-chat" as const,
      requestedModel: "openai/gpt-5",
      stream: false,
      model: "openai/gpt-5",
      body: {
        messages: [{ content: [{ type: "text", text: "id CUST-87654321 stays secret" }] }],
      },
    }

    await expect(hooks.invoke("gateway.model.request", request)).resolves.toBeUndefined()
    expect(request.body.messages[0]?.content[0]?.text).toBe("id CUST-[redacted] stays secret")
  })

  test("does not redact identifiers that are not eight digits", async () => {
    const hooks = await activate({ restrictProvider: false })
    const request = {
      protocol: "openai-chat" as const,
      requestedModel: "openai/gpt-5",
      stream: false,
      model: "openai/gpt-5",
      body: { text: "CUST-1234567 CUST-123456789 CUST-12345678" },
    }

    await expect(hooks.invoke("gateway.model.request", request)).resolves.toBeUndefined()
    expect(request.body.text).toBe("CUST-1234567 CUST-123456789 CUST-[redacted]")
  })
})
