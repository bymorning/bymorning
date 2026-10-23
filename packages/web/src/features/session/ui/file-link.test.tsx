import { cleanup, fireEvent, render } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./paced-markdown", () => ({
  PacedMarkdown: (props: { readonly text: string; readonly onContentRendered?: () => void }) => {
    queueMicrotask(() => props.onContentRendered?.())
    return <p>{props.text}</p>
  },
}))

import { FileLink } from "./file-link"

afterEach(cleanup)

describe("FileLink", () => {
  it("links exact existing prose paths and opens them by mouse or keyboard", async () => {
    const open = vi.fn()
    const view = render(() => (
      <FileLink
        text="Read src/app.ts, not app.ts."
        cacheKey="part"
        streaming={false}
        paths={["src/app.ts"]}
        onOpen={open}
      />
    ))

    await Promise.resolve()
    const link = view.container.querySelector<HTMLElement>('[data-component="file-link-target"]')!
    expect(link).toHaveTextContent("src/app.ts")
    expect(link).toHaveAttribute("role", "link")
    expect(view.container.querySelectorAll('[data-component="file-link-target"]')).toHaveLength(1)

    fireEvent.click(link)
    fireEvent.keyDown(link, { key: "Enter" })
    fireEvent.keyDown(link, { key: " " })

    expect(open).toHaveBeenNthCalledWith(1, "src/app.ts")
    expect(open).toHaveBeenNthCalledWith(2, "src/app.ts")
    expect(open).toHaveBeenNthCalledWith(3, "src/app.ts")
  })

  it("waits for streaming text to settle before linking a path", async () => {
    const view = render(() => (
      <FileLink text="Read src/app.ts" cacheKey="part" streaming paths={["src/app.ts"]} onOpen={() => {}} />
    ))

    await Promise.resolve()
    expect(view.container.querySelector('[data-component="file-link-target"]')).not.toBeInTheDocument()
  })
})
