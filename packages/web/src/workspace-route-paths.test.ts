import { describe, expect, it } from "vitest"

import { serviceAccountRouteHref, sessionRouteHref, WorkspaceRoutePath } from "./workspace-route-paths"

describe("sessionRouteHref", () => {
  it("matches the href built inline by session call sites", () => {
    expect(sessionRouteHref("wrk_1", "ses_abc")).toBe("/w/wrk_1/session/ses_abc")
  })

  it("matches WorkspaceRoutePath.session", () => {
    expect(WorkspaceRoutePath.session).toBe("/session/:sessionID")
  })
})

describe("existing route hrefs", () => {
  it("builds the Gateway href", () => {
    expect(WorkspaceRoutePath.gateway).toBe("/gateway")
  })

  it("builds service account hrefs", () => {
    expect(serviceAccountRouteHref("wrk_1", "sa abc")).toBe("/w/wrk_1/gateway/service-accounts/sa%20abc")
  })
})
