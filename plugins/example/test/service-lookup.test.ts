import { describe, expect, it } from "vitest"
import plugin from "../src/service-lookup.js"

type Execute = (
  input: { service: string },
  context: { permission: (request: unknown) => Promise<void> },
) => Promise<unknown>

function fixture(options: Record<string, unknown> = {}) {
  let execute: Execute | undefined
  let registration: { name: string; options?: { namespace?: string; permission?: string } } | undefined
  let active = 0
  let resolve = 0
  const connection = { id: "connection" }
  const setup = plugin.setup({
    options,
    integration: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          update: (_id: string, update: (integration: any) => void) => update({ name: "" }),
          method: { update: () => undefined },
        })
        return { dispose: async () => undefined }
      },
      connection: {
        active: async () => {
          active++
          return connection
        },
        resolve: async () => {
          resolve++
          return { type: "key", key: "fixture-token" }
        },
      },
    },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          namespace: () => undefined,
          add: (tool: { execute: Execute; name: string; options?: { namespace?: string; permission?: string } }) => {
            execute = tool.execute
            registration = tool
          },
        })
        return { dispose: async () => undefined }
      },
    },
  } as any)
  return {
    setup,
    execute: async (service: string, permission = async () => undefined) => {
      await setup
      if (!execute) throw new Error("Tool was not registered")
      return execute({ service }, { permission })
    },
    counts: () => ({ active, resolve }),
    registration: async () => {
      await setup
      return registration
    },
  }
}

async function withFetch(fetcher: typeof fetch, test: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = fetcher
  try {
    await test()
  } finally {
    globalThis.fetch = original
  }
}

describe("service lookup plugin", () => {
  it("registers lookup in the service namespace", async () => {
    const test = fixture()
    await expect(test.registration()).resolves.toMatchObject({
      name: "lookup",
      options: { namespace: "service", permission: "service.lookup" },
    })
  })

  it("does not resolve credentials or fetch when permission is refused", async () => {
    const test = fixture()
    let fetched = false
    await withFetch(
      async () => {
        fetched = true
        return new Response()
      },
      async () => {
        await expect(test.execute("payments", async () => Promise.reject(new Error("refused")))).rejects.toThrow(
          "refused",
        )
      },
    )
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
    expect(fetched).toBe(false)
  })

  it("resolves a fresh credential for each call and validates successful responses", async () => {
    const test = fixture()
    const requests: RequestInit[] = []
    await withFetch(
      async (_input, init) => {
        requests.push(init ?? {})
        return Response.json({
          service: "payments",
          owners: ["platform"],
          runbook: "https://runbooks.example/payments",
        })
      },
      async () => {
        await expect(test.execute("payments")).resolves.toEqual({
          output: { service: "payments", owners: ["platform"], runbook: "https://runbooks.example/payments" },
        })
        await test.execute("payments")
      },
    )
    expect(test.counts()).toEqual({ active: 2, resolve: 2 })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.headers).toEqual({ Authorization: "Bearer fixture-token", Accept: "application/json" })
    expect(requests[0]?.redirect).toBe("error")
  })

  it("sanitizes invalid and upstream responses", async () => {
    const test = fixture()
    await withFetch(
      async () => new Response("upstream body fixture-token", { status: 500 }),
      async () => {
        await expect(test.execute("payments")).rejects.toThrow("Service catalog request failed (500)")
        try {
          await test.execute("payments")
        } catch (error) {
          expect(String(error)).not.toContain("fixture-token")
          expect(String(error)).not.toContain("upstream body")
        }
      },
    )

    await withFetch(
      async () => Response.json({ service: "payments", owners: "not-an-array" }),
      async () => {
        await expect(test.execute("payments")).rejects.toThrow("Service catalog returned an invalid response")
      },
    )
  })

  it("rejects explicit unsafe base URLs", async () => {
    for (const baseURL of [
      "http://catalog.example",
      "https://token@catalog.example",
      "https://catalog.example/api",
      "https://catalog.example/?q=x",
    ]) {
      await expect(fixture({ baseURL }).setup).rejects.toThrow("Invalid Service lookup configuration")
    }
  })

  it("cancels oversized and failed response bodies", async () => {
    const test = fixture()
    let oversizedCancelled = false
    let failedCancelled = false
    const oversized = new ReadableStream<Uint8Array>({ cancel: () => void (oversizedCancelled = true) })
    const failed = new ReadableStream<Uint8Array>({ cancel: () => void (failedCancelled = true) })
    let call = 0
    await withFetch(
      async () => {
        call++
        return call === 1
          ? new Response(oversized, { headers: { "content-length": "65537" } })
          : new Response(failed, { status: 503 })
      },
      async () => {
        await expect(test.execute("payments")).rejects.toThrow("Service catalog returned an invalid response")
        await expect(test.execute("payments")).rejects.toThrow("Service catalog request failed (503)")
      },
    )
    expect(oversizedCancelled).toBe(true)
    expect(failedCancelled).toBe(true)
  })
})
