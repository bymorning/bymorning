import { cleanup, render, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Toast, showToast } from "./toast"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("Toast region", () => {
  it("lifts above a marked element that would sit beneath it, such as the Composer", async () => {
    const composer = document.createElement("div")
    composer.setAttribute("data-toast-clearance", "")
    composer.getBoundingClientRect = () => new DOMRect(0, window.innerHeight - 140, window.innerWidth, 140)
    document.body.append(composer)
    render(() => <Toast.Region />)

    showToast({ title: "Session archived" })

    await waitFor(() => {
      const region = document.querySelector<HTMLElement>(".toast-region")
      expect(region?.style.getPropertyValue("--toast-clearance")).toBe("152px")
    })
  })

  it("stays in its corner when nothing marked is beneath it", async () => {
    render(() => <Toast.Region />)

    showToast({ title: "Saved" })

    await waitFor(() => expect(document.querySelector(".toast-region [data-sonner-toast]")).toBeInTheDocument())
    expect(document.querySelector<HTMLElement>(".toast-region")?.style.getPropertyValue("--toast-clearance")).toBe("")
  })

  it("drops the lift when the marked element leaves while a toast is showing", async () => {
    const composer = document.createElement("div")
    composer.setAttribute("data-toast-clearance", "")
    composer.getBoundingClientRect = () => new DOMRect(0, window.innerHeight - 140, window.innerWidth, 140)
    document.body.append(composer)
    render(() => <Toast.Region />)
    showToast({ title: "Session archived" })
    const region = () => document.querySelector<HTMLElement>(".toast-region")
    await waitFor(() => expect(region()?.style.getPropertyValue("--toast-clearance")).toBe("152px"))
    expect(region()?.hasAttribute("data-cleared")).toBe(true)

    composer.remove()

    await waitFor(() => expect(region()?.style.getPropertyValue("--toast-clearance")).toBe(""))
    expect(region()?.hasAttribute("data-cleared")).toBe(false)
  })
})
