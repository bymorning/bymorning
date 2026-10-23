import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal, Suspense } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FileViewer, type FileViewerFile } from "./file-viewer"

const createObjectURL = vi.fn(() => "blob:preview")
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FileViewer", () => {
  it("dispatches Markdown through the shared renderer", () => {
    render(() => <FileViewer file={{ kind: "markdown", path: "README.md", source: "# Read me" }} />)

    expect(document.querySelector('[data-component="markdown"]')).toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("renders HTML in a network-restricted sandbox", () => {
    render(() => <FileViewer file={{ kind: "html", path: "site/index.html", source: "<h1>Hello</h1>" }} />)

    const preview = screen.getByTitle("HTML preview: site/index.html")
    expect(preview).toHaveAttribute("sandbox", "")
    expect(preview.getAttribute("srcdoc")).toContain(
      `Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data: blob:`,
    )
    expect(preview.getAttribute("srcdoc")).toContain("<h1>Hello</h1>")
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("renders code with line numbers without suspending for highlighting", () => {
    render(() => (
      <Suspense fallback={<p>Highlighting code…</p>}>
        <FileViewer
          file={{ kind: "code", path: "src/index.ts", source: "const greeting = 'hello'\nconsole.log(greeting)", language: "ts" }}
        />
      </Suspense>
    ))

    expect(screen.queryByText("Highlighting code…")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Code preview: src/index.ts")).toHaveTextContent("const greeting = 'hello'")
    expect(document.querySelectorAll('[data-slot="code-line"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-slot="code-line-number"]')).toHaveLength(2)
  })

  it("shows unsupported files without creating an object URL", () => {
    render(() => <FileViewer file={{ kind: "unsupported", path: "document.pdf" }} />)

    expect(screen.getByText("document.pdf")).toBeInTheDocument()
    expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("presents image loading, ready, and error states", () => {
    const view = render(() => (
      <FileViewer
        file={{ kind: "image", path: "assets/broken.png", mimeType: "image/png", data: new Blob(["image"]) }}
      />
    ))
    const image = screen.getByRole("img", { name: "assets/broken.png" })

    expect(screen.getByRole("status")).toHaveTextContent("Loading image…")
    fireEvent.load(image)
    expect(view.container.querySelector('[data-state="ready"]')).toBeInTheDocument()
    fireEvent.error(image)
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to display broken.png")
  })

  it("revokes Blob URLs on replacement and unmount", () => {
    const first = new Blob(["first"])
    const second = new Blob(["second"])
    const [file, setFile] = createSignal<FileViewerFile>({
      kind: "image",
      path: "first.png",
      mimeType: "image/png",
      data: first,
    })
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second")
    const view = render(() => <FileViewer file={file()} />)

    expect(createObjectURL).toHaveBeenCalledWith(first)
    setFile({ kind: "image", path: "second.png", mimeType: "image/png", data: second })
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first")
    expect(createObjectURL).toHaveBeenCalledWith(second)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second")
  })
})
