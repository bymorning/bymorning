import { describe, expect, it } from "vitest"
import plugin from "../src/mail.js"
import { capture, withFetch } from "./helper.js"

describe("Outlook Mail plugin", () => {
  it("registers send under its exact permission action", async () => {
    const test = capture(plugin)
    const tools = await test.tools()
    expect(tools.get("mail.message.send")?.registration.options?.permission).toBe("mail.message.send")
  })

  it("sends mail with the delegated connection and an empty-body success", async () => {
    const test = capture(plugin)
    const seen: Array<{ url: string; init: RequestInit; json: unknown }> = []
    await withFetch(
      (async (input: any, init?: RequestInit) => {
        const json = JSON.parse(String(init?.body ?? "{}"))
        seen.push({ url: String(input?.url ?? input), init: init ?? {}, json })
        return new Response(null, { status: 202 })
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("mail.message.send", { to: ["person@example.com"], subject: "Hi", body: "Hello" }),
        ).resolves.toEqual({ output: { sent: true } })
      },
    )
    expect(test.counts()).toEqual({ active: 1, resolve: 1 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toContain("/me/sendMail")
    expect(seen[0]?.json).toMatchObject({
      message: { subject: "Hi", toRecipients: [{ emailAddress: { address: "person@example.com" } }] },
      saveToSentItems: true,
    })
    expect(JSON.stringify(seen.map((entry) => entry.json))).not.toContain("fixture-access")
  })

  it("gates send behind permission before resolving credentials", async () => {
    const test = capture(plugin)
    let fetched = false
    await withFetch(
      (async () => {
        fetched = true
        return new Response(null, { status: 202 })
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("mail.message.send", { to: ["person@example.com"], subject: "Hi", body: "Hello" }, async () => {
            throw new Error("denied")
          }),
        ).rejects.toThrow("denied")
      },
    )
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
    expect(fetched).toBe(false)
  })

  it("validates message lists and requires the OAuth credential type", async () => {
    const test = capture(plugin)
    await withFetch(
      (async () =>
        Response.json({ value: [{ id: "message-id", subject: "Hi", from: { emailAddress: {} } }] })) as typeof fetch,
      async () => {
        await expect(test.run("mail.message.list", {})).resolves.toEqual({
          output: { messages: [{ id: "message-id", subject: "Hi", from: { emailAddress: {} } }] },
        })
      },
    )
    test.setCredential({ type: "key", key: "wrong-kind" })
    await withFetch((async () => Response.json({ value: [] })) as typeof fetch, async () => {
      await expect(test.run("mail.message.list", {})).rejects.toThrow("A Microsoft 365 connection is required")
    })
  })
})
