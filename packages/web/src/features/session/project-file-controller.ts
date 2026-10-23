import type { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Schema } from "effect"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, on, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

import { isProjectFileConflictError, isProjectFileNotFoundError } from "@bymorning/client"
import type { Data } from "../../context/data"
import { showToast, toaster } from "../../ui/components/toast"
import type { FileViewerFile } from "../../ui/components/file-viewer"
import { errorMessage } from "../../utils/error-message"

export type ProjectFileDirectory = Pick<
  Data["projectDirectory"],
  "observe" | "content" | "ready" | "read" | "write" | "delete" | "move"
>

export type ProjectFileListState =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly paths: ReadonlyArray<string> }
  | { readonly state: "error"; readonly message: string }

export type ProjectFilePreviewState =
  | { readonly state: "empty" }
  | { readonly state: "loading"; readonly path: string }
  | { readonly state: "ready"; readonly path: string; readonly file: FileViewerFile }
  | { readonly state: "error"; readonly path: string; readonly message: string }

export interface ProjectFileController {
  readonly filter: Accessor<string>
  readonly activePath: Accessor<string | undefined>
  readonly list: Accessor<ProjectFileListState>
  readonly visiblePaths: Accessor<ReadonlyArray<string>>
  readonly preview: Accessor<ProjectFilePreviewState>
  /** The folder chosen as the upload target; uploads go to the Project root when none is chosen. */
  readonly folder: Accessor<string | undefined>
  readonly uploading: Accessor<boolean>
  readonly setFilter: (filter: string) => void
  readonly select: (path: string) => void
  readonly selectFolder: (path: string | undefined) => void
  /** Write files into the chosen folder, reporting progress and the outcome with toasts. */
  readonly upload: (files: ReadonlyArray<File>) => Promise<void>
  /** Save one Project file through the browser, named after the file. */
  readonly download: (path: string) => Promise<void>
  /** Every listed file under a folder, ignoring the filter. */
  readonly filesIn: (folder: string) => ReadonlyArray<string>
  /**
   * Move one file to a full Project path, following an open preview. Rejects with a message for
   * inline display, such as a path another file already occupies.
   */
  readonly move: (from: string, to: string) => Promise<void>
  /** Delete one file, clearing its open preview. Rejects with a message for inline display. */
  readonly remove: (path: string) => Promise<void>
  /**
   * Move every file under a folder to a new folder path, one file at a time with progress. Rejects
   * before changing anything when the path is invalid or occupied; later per-file failures are
   * reported together in a toast.
   */
  readonly moveFolder: (from: string, to: string) => Promise<void>
  /** Delete every file under a folder, one at a time with progress; failures are reported together. */
  readonly removeFolder: (folder: string) => Promise<void>
  readonly refresh: () => void
  readonly reload: () => void
}

const maximumUploadSize = 20 * 1024 * 1024

const imageMimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
  [".svg", "image/svg+xml"],
])
const codeLanguages = new Map([
  [".astro", "astro"],
  [".c", "c"],
  [".cc", "cpp"],
  [".conf", "text"],
  [".cpp", "cpp"],
  [".cs", "csharp"],
  [".css", "css"],
  [".csv", "text"],
  [".env", "dotenv"],
  [".go", "go"],
  [".graphql", "graphql"],
  [".h", "c"],
  [".hpp", "cpp"],
  [".ini", "ini"],
  [".java", "java"],
  [".js", "js"],
  [".json", "json"],
  [".jsonc", "jsonc"],
  [".jsonl", "text"],
  [".jsx", "jsx"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".less", "less"],
  [".log", "text"],
  [".php", "php"],
  [".py", "python"],
  [".rb", "ruby"],
  [".rs", "rust"],
  [".scss", "scss"],
  [".sh", "shellscript"],
  [".sql", "sql"],
  [".svelte", "svelte"],
  [".swift", "swift"],
  [".toml", "toml"],
  [".tsv", "text"],
  [".ts", "ts"],
  [".tsx", "tsx"],
  [".txt", "text"],
  [".vue", "vue"],
  [".xml", "xml"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
])
const codeFilenames = new Map([
  ["dockerfile", "dockerfile"],
  ["makefile", "make"],
])

export function createProjectFileController(input: {
  readonly projectID: Accessor<Project.ID | undefined>
  readonly directory: ProjectFileDirectory
  readonly active: Accessor<boolean>
}): ProjectFileController {
  const [state, setState] = createStore({
    filter: "",
    activePath: undefined as string | undefined,
    projectID: input.projectID(),
    folder: undefined as string | undefined,
    uploading: false,
  })
  const filter = () => state.filter
  const activePath = () => (state.projectID === input.projectID() ? state.activePath : undefined)
  const folder = () => (state.projectID === input.projectID() ? state.folder : undefined)
  const setFilter = (value: string) => setState("filter", value)
  const paths = input.directory.observe(input.projectID, input.active)
  const bytes = input.directory.content(
    input.projectID,
    activePath,
    () => input.active() && !!activePath() && classify(activePath()!).kind !== "unsupported",
  )
  const list = (): ProjectFileListState => {
    if (!input.projectID() || !input.active()) return { state: "idle" }
    if (paths.isError) return { state: "error", message: "Unable to load Project files." }
    if (paths.isPending) return { state: "loading" }
    return { state: "ready", paths: paths.data }
  }
  const preview = createMemo<ProjectFilePreviewState>(() => {
    const path = activePath()
    if (!path || !input.active()) return { state: "empty" }
    return filePreview(path, bytes.isPending ? undefined : bytes.data, bytes.error)
  })
  const visiblePaths = createMemo(() => {
    const current = list()
    if (current.state !== "ready") return []
    const query = filter().trim()
    if (!query) return current.paths
    return fuzzysort.go(query, [...current.paths]).map((result) => result.target)
  })

  createEffect(
    on(input.projectID, () => setState({ filter: "", activePath: undefined, folder: undefined }), { defer: true }),
  )
  const select = (path: string) => setState({ projectID: input.projectID(), activePath: path, folder: undefined })
  const selectFolder = (path: string | undefined) => setState({ projectID: input.projectID(), folder: path })
  const upload = async (files: ReadonlyArray<File>) => {
    const projectID = input.projectID()
    if (!projectID || files.length === 0 || state.uploading) return
    const target = folder()
    const destination = target ? `${target}/` : "the Project root"
    setState("uploading", true)
    let progress: number | undefined
    let uploaded = 0
    const failures: string[] = []
    try {
      for (const [index, file] of files.entries()) {
        if (progress !== undefined) toaster.dismiss(progress)
        progress = showToast({
          variant: "loading",
          title: files.length === 1 ? `Uploading ${file.name}…` : `Uploading ${index + 1} of ${files.length}…`,
          description: files.length === 1 ? `To ${destination}` : file.name,
          persistent: true,
        })
        const path = target ? `${target}/${file.name}` : file.name
        if (file.size > maximumUploadSize) {
          failures.push(`${file.name} is larger than 20 MB.`)
          continue
        }
        if (!Schema.is(ProjectDirectory.Path)(path)) {
          failures.push(`${file.name} cannot be uploaded: choose a file with a valid name.`)
          continue
        }
        try {
          await input.directory.write(projectID, path, file.type || "application/octet-stream", file)
          uploaded += 1
        } catch (error) {
          failures.push(`${file.name}: ${errorMessage(error, "Upload failed.")}`)
        }
      }
    } finally {
      if (progress !== undefined) toaster.dismiss(progress)
      setState("uploading", false)
    }
    if (uploaded > 0)
      showToast({
        variant: "success",
        title: uploaded === 1 ? "File uploaded" : `${uploaded} files uploaded`,
        description: `To ${destination}`,
      })
    if (failures.length > 0)
      showToast({ variant: "error", title: "Upload failed", description: failures.join("\n"), duration: 10_000 })
  }
  const download = async (path: string) => {
    const projectID = input.projectID()
    if (!projectID) return
    try {
      saveFile(
        path.split("/").at(-1) ?? path,
        await input.directory.read(projectID, path, new AbortController().signal),
      )
    } catch (error) {
      showToast({
        variant: "error",
        title: "Download failed",
        description: errorMessage(error, `Unable to download ${path}.`),
      })
    }
  }
  const listed = () => (paths.isSuccess ? paths.data : [])
  const filesIn = (folder: string) => listed().filter((path) => path.startsWith(`${folder}/`))
  /**
   * Why a destination cannot be used: a file already there, a file where one of its folders would
   * be, or a folder of that name. Paths about to be vacated by the same change are free.
   */
  const collision = (path: string, vacating: ReadonlyArray<string> = []) => {
    const remaining = listed().filter((item) => !vacating.includes(item))
    const segments = path.split("/")
    const file = segments
      .map((_, index) => segments.slice(0, index + 1).join("/"))
      .find((prefix) => remaining.includes(prefix))
    if (file) return `A file already exists at ${file}`
    if (remaining.some((item) => item.startsWith(`${path}/`))) return `A folder already exists at ${path}`
    return undefined
  }
  /** Follow the open preview, and the upload target folder, to where their files went. */
  const relocate = (
    file: (path: string) => string | undefined,
    directory: (folder: string) => string | undefined = (folder) => folder,
  ) => {
    const active = activePath()
    const target = folder()
    setState({
      ...(active === undefined ? {} : { activePath: file(active) }),
      ...(target === undefined ? {} : { folder: directory(target) }),
    })
  }
  const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)
  const move = async (from: string, to: string) => {
    const projectID = input.projectID()
    if (!projectID) throw new Error("Project files are unavailable.")
    const target = to.trim()
    if (target === from) return
    if (!Schema.is(ProjectDirectory.Path)(target)) throw new Error(invalidPath)
    const occupied = collision(target)
    if (occupied) throw new Error(occupied)
    try {
      await input.directory.move(projectID, from, target)
    } catch (error) {
      throw new Error(changeError(error, from, `Unable to rename ${from}.`), { cause: error })
    }
    relocate((path) => (path === from ? target : path))
    showToast({
      variant: "success",
      title: parent(from) === parent(target) ? "File renamed" : "File moved",
      description: `${from} → ${target}`,
    })
  }
  const remove = async (path: string) => {
    const projectID = input.projectID()
    if (!projectID) throw new Error("Project files are unavailable.")
    try {
      await input.directory.delete(projectID, path)
    } catch (error) {
      throw new Error(changeError(error, path, `Unable to delete ${path}.`), { cause: error })
    }
    relocate((current) => (current === path ? undefined : current))
    showToast({ variant: "success", title: "File deleted", description: path })
  }
  /** Run one change per file with a progress toast, then report the outcome once. */
  const each = async (
    files: ReadonlyArray<string>,
    progress: (index: number) => string,
    change: (path: string) => Promise<void>,
  ) => {
    let toast: number | undefined
    const done: string[] = []
    const failures: string[] = []
    try {
      for (const [index, path] of files.entries()) {
        if (toast !== undefined) toaster.dismiss(toast)
        toast = showToast({ variant: "loading", title: progress(index), description: path, persistent: true })
        try {
          await change(path)
          done.push(path)
        } catch (error) {
          failures.push(`${path}: ${changeError(error, path, "Failed.")}`)
        }
      }
    } finally {
      if (toast !== undefined) toaster.dismiss(toast)
    }
    return { done, failures }
  }
  const moveFolder = async (from: string, to: string) => {
    const projectID = input.projectID()
    if (!projectID) throw new Error("Project files are unavailable.")
    const target = to.trim().replace(/\/+$/, "")
    if (target === from) return
    const files = filesIn(from)
    if (files.length === 0) throw new Error(`${from}/ no longer has any files.`)
    const destination = (path: string) => `${target}${path.slice(from.length)}`
    if (!files.every((path) => Schema.is(ProjectDirectory.Path)(destination(path)))) throw new Error(invalidFolder)
    const conflict = files.map((path) => collision(destination(path), files)).find((reason) => reason !== undefined)
    if (conflict) throw new Error(conflict)
    const { done, failures } = await each(
      files,
      (index) => `Moving ${index + 1} of ${files.length}…`,
      (path) => input.directory.move(projectID, path, destination(path)),
    )
    relocate(
      (path) => (done.includes(path) ? destination(path) : path),
      // A partly moved folder still exists where it was, so the target only follows a complete move.
      (path) => (failures.length === 0 && within(path, from) ? `${target}${path.slice(from.length)}` : path),
    )
    if (done.length > 0)
      showToast({
        variant: "success",
        title: failures.length === 0 ? "Folder renamed" : `${done.length} of ${files.length} files moved`,
        description: `${from}/ → ${target}/`,
      })
    if (failures.length > 0)
      showToast({
        variant: "error",
        title: failures.length === 1 ? "1 file was not moved" : `${failures.length} files were not moved`,
        description: failures.join("\n"),
        duration: 10_000,
      })
  }
  const removeFolder = async (folder: string) => {
    const projectID = input.projectID()
    if (!projectID) throw new Error("Project files are unavailable.")
    const files = filesIn(folder)
    if (files.length === 0) throw new Error(`${folder}/ no longer has any files.`)
    const { done, failures } = await each(
      files,
      (index) => `Deleting ${index + 1} of ${files.length}…`,
      (path) => input.directory.delete(projectID, path),
    )
    relocate(
      (path) => (done.includes(path) ? undefined : path),
      (path) => (failures.length === 0 && within(path, folder) ? undefined : path),
    )
    if (done.length > 0)
      showToast({
        variant: "success",
        title: failures.length === 0 ? "Folder deleted" : `${done.length} of ${files.length} files deleted`,
        description: `${folder}/`,
      })
    if (failures.length > 0)
      showToast({
        variant: "error",
        title: failures.length === 1 ? "1 file was not deleted" : `${failures.length} files were not deleted`,
        description: failures.join("\n"),
        duration: 10_000,
      })
  }
  const refresh = () => {
    if (input.projectID() && input.active() && input.directory.ready()) void paths.refetch()
  }
  const reload = () => {
    refresh()
    if (
      input.projectID() &&
      input.active() &&
      input.directory.ready() &&
      activePath() &&
      classify(activePath()!).kind !== "unsupported"
    )
      void bytes.refetch()
  }
  return {
    filter,
    activePath,
    list,
    visiblePaths,
    preview,
    folder,
    uploading: () => state.uploading,
    setFilter,
    select,
    selectFolder,
    upload,
    download,
    filesIn,
    move,
    remove,
    moveFolder,
    removeFolder,
    refresh,
    reload,
  }
}

const invalidPath = "Enter a valid file path, such as docs/notes.md."
const invalidFolder = "Enter a valid folder path, such as docs/archive."

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")))

/** A change failure as a sentence for inline display or a toast line. */
function changeError(error: unknown, path: string, fallback: string) {
  if (isProjectFileConflictError(error)) return `A file already exists at ${error.path}`
  if (isProjectFileNotFoundError(error)) return `${path} no longer exists.`
  return errorMessage(error, fallback)
}

/** Hand bytes to the browser as a download; the object URL is released once the download has started. */
function saveFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/octet-stream" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function filePreview(path: string, bytes: Uint8Array | undefined, error: unknown): ProjectFilePreviewState {
  const classification = classify(path)
  if (classification.kind === "unsupported") return { state: "ready", path, file: { kind: "unsupported", path } }
  if (error)
    return {
      state: "error",
      path,
      message: isProjectFileNotFoundError(error) ? `${error.path} is no longer available.` : `Unable to load ${path}.`,
    }
  if (!bytes) return { state: "loading", path }
  if (classification.kind === "image")
    return {
      state: "ready",
      path,
      file: {
        kind: "image",
        path,
        mimeType: classification.mimeType,
        data: new Blob([Uint8Array.from(bytes)], { type: classification.mimeType }),
      },
    }
  return decodeText(path, bytes, classification)
}

export function classify(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return { kind: "markdown" } as const
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return { kind: "html" } as const
  const extension = lower.slice(lower.lastIndexOf("."))
  const mimeType = imageMimeTypes.get(extension)
  if (mimeType) return { kind: "image", mimeType } as const
  const language = codeLanguages.get(extension) ?? codeFilenames.get(lower.split("/").at(-1) ?? lower)
  if (language) return { kind: "code", language } as const
  return { kind: "unsupported" } as const
}

export function decodeText(
  path: string,
  bytes: Uint8Array,
  classification: { readonly kind: "markdown" | "html" } | { readonly kind: "code"; readonly language: string },
): ProjectFilePreviewState {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return {
      state: "ready",
      path,
      file:
        classification.kind === "code"
          ? { kind: "code", path, source, language: classification.language }
          : { kind: classification.kind, path, source },
    }
  } catch {
    const label = classification.kind === "markdown" ? "Markdown" : classification.kind === "html" ? "HTML" : "text"
    return { state: "error", path, message: `${path} is not valid UTF-8 ${label}.` }
  }
}
