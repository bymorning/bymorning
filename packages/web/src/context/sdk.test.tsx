import { ByMorning } from "@bymorning/client"
import { render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SDKProvider, useSDK, type SDK } from "./sdk"

function mount() {
  let sdk!: SDK.Interface
  const view = render(() => (
    <SDKProvider>
      {(() => {
        sdk = useSDK()
        return <div />
      })()}
    </SDKProvider>
  ))
  return { sdk: () => sdk, unmount: view.unmount }
}

afterEach(() => vi.restoreAllMocks())

describe("SDKProvider", () => {
  it("creates one credentialed client against the page origin outside production", async () => {
    const make = vi.spyOn(ByMorning, "make")
    const request = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    )
    const mounted = mount()

    await mounted.sdk().client.workspace.list()

    expect(make).toHaveBeenCalledOnce()
    expect(make.mock.calls[0]?.[0]).toMatchObject({ baseUrl: new URL("/", window.location.origin).href })
    expect(mounted.sdk().baseURL).toBe(new URL("/", window.location.origin).href)
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: "include" }))
    mounted.unmount()
  })
})
