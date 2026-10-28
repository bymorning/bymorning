import { describe, expect, it } from "vitest"
import calendar from "../src/calendar.js"
import onedrive from "../src/onedrive.js"
import teams from "../src/teams.js"
import { capture, withFetch } from "./helper.js"

describe("OneDrive plugin", () => {
  it("reads folders", async () => {
    const test = capture(onedrive)
    await withFetch(
      (async () => Response.json({ value: [{ id: "child-id", name: "Notes" }] })) as typeof fetch,
      async () => {
        await expect(test.run("onedrive.item.list", { itemID: "root" })).resolves.toEqual({
          output: { items: [{ id: "child-id", name: "Notes" }] },
        })
      },
    )
    expect(test.counts()).toEqual({ active: 1, resolve: 1 })
  })

  it("refuses permission before any credential use", async () => {
    const test = capture(onedrive)
    await withFetch((async () => Response.json({ id: "drive-id" })) as typeof fetch, async () => {
      await expect(
        test.run("onedrive.drive.get", {}, async () => {
          throw new Error("denied")
        }),
      ).rejects.toThrow("denied")
    })
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
  })
})

describe("Calendar plugin", () => {
  it("creates events", async () => {
    const test = capture(calendar)
    const seen: Array<{ json: unknown }> = []
    await withFetch(
      (async (_input: any, init?: RequestInit) => {
        seen.push({ json: JSON.parse(String(init?.body ?? "{}")) })
        return Response.json({ id: "event-id", webLink: "https://example/event" })
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("calendar.event.create", {
            subject: "Standup",
            start: "2026-09-11T09:00:00Z",
            end: "2026-09-11T09:15:00Z",
          }),
        ).resolves.toEqual({ output: { id: "event-id", webLink: "https://example/event" } })
        expect(seen[0]?.json).toMatchObject({ subject: "Standup" })
      },
    )
  })

  it("rejects invalid events without leaking the access token", async () => {
    const test = capture(calendar)
    await withFetch((async () => Response.json({ subject: "missing-id" })) as typeof fetch, async () => {
      try {
        await test.run("calendar.event.get", { eventID: "event-id" })
        expect.unreachable()
      } catch (error) {
        expect(String(error)).toContain("Microsoft Graph returned an invalid response")
        expect(String(error)).not.toContain("fixture-access")
      }
    })
  })
})

describe("Teams plugin", () => {
  it("lists joined teams", async () => {
    const test = capture(teams)
    await withFetch(
      (async () => Response.json({ value: [{ id: "team-id", displayName: "Engineering" }] })) as typeof fetch,
      async () => {
        await expect(test.run("teams.team.list", {})).resolves.toEqual({
          output: { teams: [{ id: "team-id", displayName: "Engineering" }] },
        })
      },
    )
  })

  it("gates channel messages behind permission", async () => {
    const test = capture(teams)
    let fetched = false
    await withFetch(
      (async () => {
        fetched = true
        return Response.json({ value: [] })
      }) as typeof fetch,
      async () => {
        await expect(
          test.run("teams.message.list", { teamID: "team-id", channelID: "channel-id" }, async () => {
            throw new Error("denied")
          }),
        ).rejects.toThrow("denied")
      },
    )
    expect(fetched).toBe(false)
    expect(test.counts()).toEqual({ active: 0, resolve: 0 })
  })
})
