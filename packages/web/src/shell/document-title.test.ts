import { describe, expect, it } from "vitest"

import { documentTitle } from "./document-title"

const base = {
  workspaceID: "wrk_1",
  sessionTitle: (id: string) => (id === "ses_1" ? "Quarterly report" : undefined),
  projectName: (id: string) => (id === "prj_1" ? "Atlas" : undefined),
}
const title = (pathname: string) => documentTitle({ ...base, pathname })

describe("documentTitle", () => {
  it("names Workspace pages", () => {
    expect(title("/w/wrk_1")).toBe("Overview · ByMorning")
    expect(title("/w/wrk_1/")).toBe("Overview · ByMorning")
    expect(title("/w/wrk_1/scheduled-tasks")).toBe("Scheduled tasks · ByMorning")
  })

  it("names the new session page and routing like their headings", () => {
    expect(title("/w/wrk_1/new-session")).toBe("New session · ByMorning")
    expect(title("/w/wrk_1/policies")).toBe("Model routing · ByMorning")
  })

  it("names sessions and projects, falling back while they load", () => {
    expect(title("/w/wrk_1/session/ses_1")).toBe("Quarterly report · ByMorning")
    expect(title("/w/wrk_1/session/ses_2")).toBe("Session · ByMorning")
    expect(title("/w/wrk_1/prj/prj_1")).toBe("Atlas · ByMorning")
    expect(title("/w/wrk_1/prj/prj_2")).toBe("Project · ByMorning")
  })

  it("names Console pages and their detail routes", () => {
    expect(title("/w/wrk_1/gateway")).toBe("Console overview · ByMorning")
    expect(title("/w/wrk_1/members")).toBe("Members · ByMorning")
    expect(title("/w/wrk_1/installation")).toBe("Installation · ByMorning")
    expect(title("/w/wrk_1/installation/policy")).toBe("Installation Policy · ByMorning")
    expect(title("/w/wrk_1/gateway/service-accounts/sa_1")).toBe("Service accounts · ByMorning")
  })

  it("falls back to the product name", () => {
    expect(title("/w/wrk_1/form")).toBe("ByMorning")
  })
})
