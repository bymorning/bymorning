import { describe, expect, it } from "vitest"

import { serviceAccountRouteHref, sessionRouteHref } from "./workspace-route-paths"

describe("route hrefs", () => {
  it("builds the session href used by session call sites", () => {
    expect(sessionRouteHref("wrk_1", "ses_abc")).toBe("/w/wrk_1/session/ses_abc")
  })

  it("encodes service account IDs in hrefs", () => {
    expect(serviceAccountRouteHref("wrk_1", "sa abc")).toBe("/w/wrk_1/gateway/service-accounts/sa%20abc")
  })
})
