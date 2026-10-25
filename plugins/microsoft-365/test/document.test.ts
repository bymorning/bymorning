import { describe, expect, it } from "vitest"
import plugin from "../src/document.js"
import { capture, withFetch } from "./helper.js"

describe("Document plugin", () => {
  it("bounds downloads and truncates previews", async () => {
    const test = capture(plugin)
    const body = "x".repeat(5_000)
    await withFetch(
      (async (input: any) => {
        const url = String(input?.url ?? input)
        if (url.endsWith("/content")) {
          return new Response(body, { headers: { "content-type": "application/octet-stream" } })
        }
        return Response.json({ id: "item-id", name: "Deck.pptx", file: { mimeType: "application/vnd.ms-powerpoint" } })
      }) as typeof fetch,
      async () => {
        const result = (await test.run("document.file.content", { itemID: "item-id" })) as {
          output: { preview: string; truncated: boolean; size: number; mimeType: string }
        }
        expect(result.output.preview).toHaveLength(4_000)
        expect(result.output.truncated).toBe(true)
        expect(result.output.size).toBe(5_000)
        expect(result.output.mimeType).toBe("application/vnd.ms-powerpoint")
        expect(JSON.stringify(result)).not.toContain("fixture-access")
      },
    )
    expect(test.counts()).toEqual({ active: 1, resolve: 1 })
  })

  it("gates file content behind permission before any download", async () => {
    const test = capture(plugin)
    let fetched = false
    await withFetch(
      (async () => {
        fetched = true
        return new Response("binary")
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("document.file.content", { itemID: "item-id" }, async () => {
            throw new Error("denied")
          }),
        ).rejects.toThrow("denied")
      },
    )
    expect(fetched).toBe(false)
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
  })
})
