import { ByMorning } from "@bymorning/client"
import { Project } from "@bymorning/schema/project"
import * as Workspace from "@bymorning/schema/workspace"
import { waitFor } from "@solidjs/testing-library"
import { createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { describe, expect, it, vi } from "vitest"
import { createProjectDirectoryData } from "../../context/data/project-directory"
import { createQuery, recoverDirectory } from "../../runtime/server/query"
import { contentQuery, directoryMutation, directoryQuery } from "../../project/directory"
import { classify, createProjectFileController, filePreview } from "./project-file-controller"

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn(() => 1) }))
vi.mock("../../ui/components/toast", () => ({ showToast, toaster: { dismiss: vi.fn() } }))

const encoder = new TextEncoder()
/** jsdom's File lacks arrayBuffer, which the SDK upload path reads. */
const upload = (name: string, text: string, type = "") => {
  const data = encoder.encode(text)
  return Object.assign(new File([data], name, { type }), { arrayBuffer: async () => data.buffer })
}
function fixture() {
  const files = new Map<string, Uint8Array>([
    ["README.md", encoder.encode("# Project")],
    ["src/main.ts", encoder.encode("const x = 1")],
    ["image.png", new Uint8Array([0, 255, 1])],
  ])
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.searchParams.get("path")
    if (init?.method === "POST" && url.pathname.endsWith("/directory/move")) {
      const { from, to } = JSON.parse(String(init.body)) as { from: string; to: string }
      const bytes = files.get(from)
      if (!bytes)
        return Response.json(
          { _tag: "ProjectFile.NotFoundError", path: from, message: `Project file not found: ${from}` },
          { status: 404 },
        )
      if (files.has(to))
        return Response.json(
          { _tag: "ProjectFile.ConflictError", path: to, message: `A Project file already exists at ${to}` },
          { status: 409 },
        )
      files.delete(from)
      files.set(to, bytes)
      return new Response(null, { status: 204 })
    }
    if (path === null) return Response.json({ paths: [...files.keys()].toSorted() })
    if (init?.method === "DELETE") {
      if (!files.delete(path))
        return Response.json(
          { _tag: "ProjectFile.NotFoundError", path, message: `Project file not found: ${path}` },
          { status: 404 },
        )
      return new Response(null, { status: 204 })
    }
    if (init?.method === "PUT") {
      files.set(path, new Uint8Array(await new Response(init.body).arrayBuffer()))
      return new Response(null, { status: 204 })
    }
    const bytes = files.get(path)
    return bytes
      ? new Response(Uint8Array.from(bytes), { headers: { "content-type": "application/octet-stream" } })
      : Response.json(
          { _tag: "ProjectFile.NotFoundError", path, message: `Project file not found: ${path}` },
          { status: 404 },
        )
  })
  const scope = {
    origin: "http://files.test",
    identity: "one",
    workspace: Workspace.ID.create(),
    api: ByMorning.make({ baseUrl: "http://files.test", fetch }),
  }
  const query = createQuery()
  return createRoot((dispose) => {
    onCleanup(() => query.clear())
    const [state, setState] = createStore({ projectID: Project.ID.create(), active: false, ready: true })
    const directory = createProjectDirectoryData({ scope, query, ready: () => state.ready })
    const upload = directoryMutation(scope, query)
    const model = createProjectFileController({
      projectID: () => state.projectID,
      active: () => state.active,
      directory,
    })
    return { scope, query, directory, upload, model, state, setState, fetch, files, dispose }
  })
}

describe("shared Project file queries", () => {
  it("does not retry a failed paths request on each search term and supports explicit refresh", async () => {
    const f = fixture()
    f.fetch.mockRejectedValueOnce(new Error("offline"))
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("error"))
    const error = f.query.getQueryState(directoryQuery(f.scope, f.state.projectID).queryKey)?.error
    const signal = new AbortController().signal
    await expect(f.directory.search(f.state.projectID, "main", signal)).rejects.toBe(error)
    await expect(f.directory.search(f.state.projectID, "README", signal)).rejects.toBe(error)
    expect(f.fetch).toHaveBeenCalledOnce()
    f.model.refresh()
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    expect(f.fetch).toHaveBeenCalledTimes(2)
    f.dispose()
  })
  it("aborts an unobserved preview when the sidebar closes", async () => {
    const f = fixture()
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    const pending = Promise.withResolvers<Response>()
    let signal: AbortSignal | null | undefined
    f.fetch.mockImplementationOnce((_input, init) => {
      signal = init?.signal
      return pending.promise
    })
    f.model.select("README.md")
    await waitFor(() => expect(signal).toBeDefined())
    f.setState("active", false)
    expect(signal?.aborted).toBe(true)
    pending.resolve(new Response("obsolete", { headers: { "content-type": "application/octet-stream" } }))
    expect(f.model.preview()).toEqual({ state: "empty" })
    f.dispose()
  })
  it("loads on activation, deduplicates observers and searches every term locally", async () => {
    const f = fixture()
    expect(f.model.list()).toEqual({ state: "idle" })
    expect(f.fetch).not.toHaveBeenCalled()
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    const signal = new AbortController().signal
    expect(await f.directory.search(f.state.projectID, "main", signal)).toEqual(["src/main.ts"])
    expect(await f.directory.search(f.state.projectID, "README", signal)).toEqual(["README.md"])
    f.model.setFilter("main")
    expect(f.model.visiblePaths()).toEqual(["src/main.ts"])
    f.setState("active", false)
    f.setState("active", true)
    expect(f.fetch).toHaveBeenCalledOnce()
    f.dispose()
  })

  it("renders binary images, UTF-8 text, invalid text, unsupported files and original missing-file errors", async () => {
    const f = fixture()
    f.setState("active", true)
    f.model.select("README.md")
    await waitFor(() =>
      expect(f.model.preview()).toMatchObject({ state: "ready", file: { kind: "markdown", source: "# Project" } }),
    )
    f.model.select("image.png")
    await waitFor(() =>
      expect(f.model.preview()).toMatchObject({ state: "ready", file: { kind: "image", mimeType: "image/png" } }),
    )
    expect(f.query.getQueryData(contentQuery(f.scope, f.state.projectID, "image.png").queryKey)).toEqual(
      new Uint8Array([0, 255, 1]),
    )
    const calls = f.fetch.mock.calls.length
    f.model.select("archive.zip")
    expect(f.model.preview()).toMatchObject({ state: "ready", file: { kind: "unsupported" } })
    expect(f.fetch).toHaveBeenCalledTimes(calls)
    f.model.select("missing.md")
    await waitFor(() =>
      expect(f.model.preview()).toMatchObject({ state: "error", message: "missing.md is no longer available." }),
    )
    expect(f.query.getQueryState(contentQuery(f.scope, f.state.projectID, "missing.md").queryKey)?.error).toMatchObject(
      { _tag: "ProjectFile.NotFoundError" },
    )
    expect(filePreview("invalid.txt", new Uint8Array([255]), null)).toMatchObject({
      state: "error",
      message: "invalid.txt is not valid UTF-8 text.",
    })
    f.dispose()
  })

  it("writes exact binary bytes and refreshes the active overwritten preview once", async () => {
    const f = fixture()
    f.setState("active", true)
    f.model.select("README.md")
    await waitFor(() => expect(f.model.preview().state).toBe("ready"))
    const data = encoder.encode("# Updated")
    const file = Object.assign(new File([data], "README.md"), { arrayBuffer: async () => data.buffer })
    await f.upload.mutateAsync({
      scope: f.scope,
      projectID: f.state.projectID,
      path: file.name,
      contentType: "application/custom",
      file,
    })
    await waitFor(() => expect(f.model.preview()).toMatchObject({ file: { source: "# Updated" } }))
    expect([...f.files.get(file.name)!]).toEqual([...data])
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1)
    expect(
      f.fetch.mock.calls.filter(([input, init]) => String(input).includes("path=README.md") && init?.method === "GET"),
    ).toHaveLength(2)
    f.dispose()
  })

  it("uploads into the chosen folder, else the root, and refreshes the listing", async () => {
    const f = fixture()
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    const root = upload("root.txt", "a", "text/plain")
    await f.model.upload([root])
    expect([...f.files.keys()]).toContain("root.txt")
    await waitFor(() => expect(f.model.visiblePaths()).toContain("root.txt"))
    f.model.selectFolder("src")
    expect(f.model.folder()).toBe("src")
    await f.model.upload([upload("nested.txt", "b"), upload("other.bin", "c")])
    expect([...f.files.keys()]).toEqual(expect.arrayContaining(["src/nested.txt", "src/other.bin"]))
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "success", title: "2 files uploaded" }),
    )
    f.model.select("README.md")
    expect(f.model.folder()).toBeUndefined()
    f.dispose()
  })

  it("reports oversized files and failed writes without stopping the rest", async () => {
    const f = fixture()
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    showToast.mockClear()
    const large = upload("large.bin", "x")
    Object.defineProperty(large, "size", { value: 21 * 1024 * 1024 })
    await f.model.upload([large, upload("ok.txt", "ok")])
    expect([...f.files.keys()]).toContain("ok.txt")
    expect([...f.files.keys()]).not.toContain("large.bin")
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        title: "Upload failed",
        description: "large.bin is larger than 20 MB.",
      }),
    )
    f.dispose()
  })

  it("downloads a file through the browser named after it, with its exact bytes", async () => {
    const f = fixture()
    f.setState("active", true)
    const create = vi.fn(() => "blob:test")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const clicked: Array<{ name: string; href: string }> = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ name: this.download, href: this.href })
    })
    await f.model.download("src/main.ts")
    expect(clicked).toEqual([{ name: "main.ts", href: "blob:test" }])
    const blob = (create.mock.calls[0] as unknown as [Blob])[0]
    const read = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    })
    expect([...new Uint8Array(read)]).toEqual([...encoder.encode("const x = 1")])
    await f.model.download("missing.md")
    expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "error", title: "Download failed" }))
    click.mockRestore()
    vi.unstubAllGlobals()
    f.dispose()
  })

  it("recovers only active queries in the captured scope", async () => {
    const f = fixture()
    f.setState("active", true)
    f.model.select("README.md")
    await waitFor(() => expect(f.model.preview().state).toBe("ready"))
    const other = { ...f.scope, identity: "other" }
    await f.query.fetchQuery(directoryQuery(other, f.state.projectID))
    f.files.set("README.md", encoder.encode("Recovered"))
    f.fetch.mockClear()
    await recoverDirectory(f.query, f.scope)
    await waitFor(() => expect(f.model.preview()).toMatchObject({ file: { source: "Recovered" } }))
    expect(f.fetch).toHaveBeenCalledTimes(2)
    expect(f.query.getQueryData(directoryQuery(other, f.state.projectID).queryKey)).toHaveLength(3)
    f.dispose()
  })

  it("forwards Query cancellation to the SDK and isolates late identity responses", async () => {
    const f = fixture()
    const deferred = Promise.withResolvers<Response>()
    let signal: AbortSignal | null | undefined
    f.fetch.mockImplementationOnce((_input, init) => {
      signal = init?.signal
      return deferred.promise
    })
    const old = f.query
      .fetchQuery(contentQuery(f.scope, f.state.projectID, "README.md"))
      .catch((error: unknown) => error)
    await waitFor(() => expect(signal).toBeDefined())
    await f.query.cancelQueries({ queryKey: contentQuery(f.scope, f.state.projectID, "README.md").queryKey })
    expect(signal?.aborted).toBe(true)
    const next = { ...f.scope, identity: "next" }
    expect([...(await f.query.fetchQuery(contentQuery(next, f.state.projectID, "README.md")))]).toEqual([
      ...encoder.encode("# Project"),
    ])
    deferred.resolve(new Response("obsolete"))
    await old
    expect(f.query.getQueryData(contentQuery(f.scope, f.state.projectID, "README.md").queryKey)).toBeUndefined()
    f.dispose()
  })

  it("waits for shared readiness and resets selection when the project changes", async () => {
    const f = fixture()
    f.setState({ active: true, ready: false })
    expect(f.fetch).not.toHaveBeenCalled()
    f.setState("ready", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    f.model.select("README.md")
    await waitFor(() => expect(f.model.preview().state).toBe("ready"))
    f.setState("projectID", Project.ID.create())
    expect(f.model.activePath()).toBeUndefined()
    expect(f.model.preview()).toEqual({ state: "empty" })
    f.dispose()
  })
})

describe("Project file changes", () => {
  const ready = async () => {
    const f = fixture()
    f.setState("active", true)
    await waitFor(() => expect(f.model.list().state).toBe("ready"))
    showToast.mockClear()
    return f
  }
  const changes = (f: ReturnType<typeof fixture>) =>
    f.fetch.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "DELETE")

  it("moves a file, follows its open preview, and refreshes the listing", async () => {
    const f = await ready()
    f.model.select("src/main.ts")
    await waitFor(() => expect(f.model.preview()).toMatchObject({ state: "ready", file: { source: "const x = 1" } }))
    await f.model.move("src/main.ts", " lib/entry.ts ")
    expect(f.model.activePath()).toBe("lib/entry.ts")
    await waitFor(() => expect(f.model.visiblePaths()).toEqual(["README.md", "image.png", "lib/entry.ts"]))
    await waitFor(() => expect(f.model.preview()).toMatchObject({ state: "ready", file: { source: "const x = 1" } }))
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "success", title: "File moved", description: "src/main.ts → lib/entry.ts" }),
    )
    await f.model.move("README.md", "GUIDE.md")
    expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "File renamed" }))
    f.dispose()
  })

  it("refuses an invalid or occupied destination inline, including one taken since the listing loaded", async () => {
    const f = await ready()
    await expect(f.model.move("README.md", "../escape.md")).rejects.toThrow(
      "Enter a valid file path, such as docs/notes.md.",
    )
    await expect(f.model.move("README.md", "image.png")).rejects.toThrow("A file already exists at image.png")
    expect(changes(f)).toHaveLength(0)
    f.files.set("late.md", encoder.encode("late"))
    await expect(f.model.move("README.md", "late.md")).rejects.toThrow("A file already exists at late.md")
    await expect(f.model.move("gone.md", "elsewhere.md")).rejects.toThrow("gone.md no longer exists.")
    await f.model.move("README.md", "README.md")
    expect(changes(f)).toHaveLength(2)
    expect(showToast).not.toHaveBeenCalled()
    f.dispose()
  })

  it("deletes a file and clears its open preview", async () => {
    const f = await ready()
    f.model.select("README.md")
    await waitFor(() => expect(f.model.preview().state).toBe("ready"))
    await f.model.remove("README.md")
    expect(f.model.activePath()).toBeUndefined()
    expect(f.model.preview()).toEqual({ state: "empty" })
    await waitFor(() => expect(f.model.visiblePaths()).toEqual(["image.png", "src/main.ts"]))
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "success", title: "File deleted", description: "README.md" }),
    )
    await expect(f.model.remove("README.md")).rejects.toThrow("README.md no longer exists.")
    f.dispose()
  })

  it("renames a folder file by file, following the preview and upload target", async () => {
    const f = await ready()
    f.files.set("src/util/math.ts", encoder.encode("export {}"))
    f.model.refresh()
    await waitFor(() => expect(f.model.filesIn("src")).toEqual(["src/main.ts", "src/util/math.ts"]))
    f.model.select("src/util/math.ts")
    f.model.selectFolder("src/util")
    await expect(f.model.moveFolder("src", "README.md")).rejects.toThrow("A file already exists at README.md")
    await expect(f.model.move("README.md", "src")).rejects.toThrow("A folder already exists at src")
    f.files.set("lib/main.ts", encoder.encode("taken"))
    f.model.refresh()
    await waitFor(() => expect(f.model.visiblePaths()).toContain("lib/main.ts"))
    await expect(f.model.moveFolder("src", "lib/")).rejects.toThrow("A file already exists at lib/main.ts")
    expect(changes(f)).toHaveLength(0)

    await f.model.moveFolder("src", "source/")
    expect([...f.files.keys()].toSorted()).toEqual([
      "README.md",
      "image.png",
      "lib/main.ts",
      "source/main.ts",
      "source/util/math.ts",
    ])
    expect(f.model.activePath()).toBe("source/util/math.ts")
    expect(f.model.folder()).toBe("source/util")
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "loading", title: "Moving 2 of 2…" }))
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "success", title: "Folder renamed", description: "src/ → source/" }),
    )
    await waitFor(() => expect(f.model.filesIn("source")).toEqual(["source/main.ts", "source/util/math.ts"]))
    f.dispose()
  })

  it("deletes every file in a folder and reports the files it could not delete together", async () => {
    const f = await ready()
    f.files.set("src/util/math.ts", encoder.encode("export {}"))
    f.model.refresh()
    await waitFor(() => expect(f.model.filesIn("src")).toHaveLength(2))
    f.model.select("src/main.ts")
    // Another client removed one file after this listing loaded.
    f.files.delete("src/util/math.ts")
    await f.model.removeFolder("src")
    expect([...f.files.keys()].toSorted()).toEqual(["README.md", "image.png"])
    expect(f.model.activePath()).toBeUndefined()
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", title: "1 of 2 files deleted", description: "src/" }),
    )
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variant: "error",
        title: "1 file was not deleted",
        description: "src/util/math.ts: src/util/math.ts no longer exists.",
      }),
    )
    f.dispose()
  })
})

describe("classify", () => {
  it.each(["data.csv", "data.TSV", "events.jsonl", "notes.txt", "run.log", "config.yaml"])(
    "previews %s as text",
    (path) => {
      expect(classify(path).kind).toBe("code")
    },
  )

  it("leaves binary types unsupported", () => {
    expect(classify("archive.zip").kind).toBe("unsupported")
  })
})
