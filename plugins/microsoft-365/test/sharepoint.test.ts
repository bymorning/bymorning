import { describe, expect, it } from "vitest"
import plugin from "../src/sharepoint.js"
import { capture, withFetch } from "./helper.js"

describe("SharePoint plugin", () => {
  it("registers under the sharepoint namespace as a member-only Integration", async () => {
    const test = capture(plugin)
    const tools = await test.tools()
    expect(tools.get("sharepoint.site.get")?.registration.options).toEqual({
      namespace: "sharepoint",
      permission: "sharepoint.site.get",
    })
    await expect(test.integration()).resolves.toMatchObject({
      id: "microsoft-365",
      connectionPolicy: "member-only",
    })
  })

  it("does not resolve credentials or fetch when permission is refused", async () => {
    const test = capture(plugin)
    let fetched = false
    await withFetch(
      (async () => {
        fetched = true
        return new Response()
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("sharepoint.site.get", { siteID: "example.sharepoint.com" }, async () => {
            throw new Error("refused")
          }),
        ).rejects.toThrow("refused")
      },
    )
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
    expect(fetched).toBe(false)
  })

  it("resolves a fresh credential for each call and validates responses", async () => {
    const test = capture(plugin)
    const requests: RequestInit[] = []
    await withFetch(
      (async (_input: any, init?: RequestInit) => {
        requests.push(init ?? {})
        return Response.json({ id: "site-id", displayName: "Team site", webUrl: "https://example.sharepoint.com" })
      }) as typeof fetch,
      async () => {
        await expect(test.run("sharepoint.site.get", { siteID: "site-id" })).resolves.toEqual({
          output: { id: "site-id", displayName: "Team site", webUrl: "https://example.sharepoint.com" },
        })
        await test.run("sharepoint.site.get", { siteID: "site-id" })
      },
    )
    expect(test.counts()).toEqual({ active: 2, resolve: 2 })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.headers).toMatchObject({ Authorization: "Bearer fixture-access" })
    expect(requests[0]?.redirect).toBe("error")
  })

  it("sanitizes upstream failures and invalid responses", async () => {
    const test = capture(plugin)
    await withFetch(
      (async () => new Response("upstream body fixture-access", { status: 500 })) as typeof fetch,
      async () => {
        await expect(test.run("sharepoint.site.get", { siteID: "site-id" })).rejects.toThrow(
          "Microsoft Graph request failed (500)",
        )
        try {
          await test.run("sharepoint.site.get", { siteID: "site-id" })
        } catch (error) {
          expect(String(error)).not.toContain("fixture-access")
          expect(String(error)).not.toContain("upstream body")
        }
      },
    )
    await withFetch((async () => Response.json({ value: "not-an-array" })) as typeof fetch, async () => {
      await expect(test.run("sharepoint.drive.list", { siteID: "site-id" })).rejects.toThrow(
        "Microsoft Graph returned an invalid response",
      )
    })
  })
})
