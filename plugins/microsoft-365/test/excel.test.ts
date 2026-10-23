import { describe, expect, it } from "vitest"
import plugin from "../src/excel.js"
import { capture, withFetch } from "./helper.js"

describe("Excel plugin", () => {
  it("registers workbook tools with delegated session support", async () => {
    const test = capture(plugin)
    expect([...(await test.tools()).keys()].sort()).toEqual([
      "excel.range.get",
      "excel.session.create",
      "excel.worksheet.list",
    ])
  })

  it("creates delegated sessions and forwards the session header", async () => {
    const test = capture(plugin)
    const seen: Array<{ url: string; init: RequestInit; json: unknown }> = []
    await withFetch(
      (async (input: any, init?: RequestInit) => {
        const url = String(input?.url ?? input)
        seen.push({ url, init: init ?? {}, json: init?.body ? JSON.parse(String(init.body)) : undefined })
        if (url.endsWith("/createSession")) return Response.json({ id: "session-id" })
        return Response.json({ value: [{ id: "sheet-id", name: "Sheet1", position: 0 }] })
      }) as typeof fetch,
      async () => {
        await expect(test.run("excel.session.create", { itemID: "item-id" })).resolves.toEqual({
          output: { id: "session-id" },
        })
        await expect(test.run("excel.worksheet.list", { itemID: "item-id", sessionID: "session-id" })).resolves.toEqual(
          { output: { worksheets: [{ id: "sheet-id", name: "Sheet1", position: 0 }] } },
        )
      },
    )
    expect(seen[0]?.url).toContain("/createSession")
    expect(seen[0]?.json).toEqual({ persistChanges: false })
    expect(seen[1]?.init.headers).toMatchObject({ "Workbook-Session-Id": "session-id" })
    expect(test.counts()).toEqual({ active: 2, resolve: 2 })
  })

  it("gates range reads behind permission before resolving credentials", async () => {
    const test = capture(plugin)
    let fetched = false
    await withFetch(
      (async () => {
        fetched = true
        return Response.json({ address: "Sheet1!A1:B2", values: [["a"]] })
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("excel.range.get", { itemID: "item-id", worksheet: "Sheet1", address: "A1:B2" }, async () => {
            throw new Error("denied")
          }),
        ).rejects.toThrow("denied")
      },
    )
    expect(fetched).toBe(false)
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
  })

  it("sanitizes invalid workbook responses without leaking tokens", async () => {
    const test = capture(plugin)
    await withFetch((async () => Response.json({ value: [{ id: "sheet-id" }] })) as typeof fetch, async () => {
      try {
        await test.run("excel.worksheet.list", { itemID: "item-id" })
        expect.unreachable()
      } catch (error) {
        expect(String(error)).toContain("Microsoft Graph returned an invalid response")
        expect(String(error)).not.toContain("fixture-access")
      }
    })
  })
})
