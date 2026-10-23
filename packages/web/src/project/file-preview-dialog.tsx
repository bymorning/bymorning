import type { Project } from "@bymorning/schema/project"
import { createMemo, Match, Switch, type JSX } from "solid-js"

import { useData } from "../context/data"
import { classify, filePreview } from "../features/session/project-file-controller"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "../ui/components/dialog"
import { FileViewer } from "../ui/components/file-viewer"
import { Spinner } from "../ui/components/spinner"
import "./file-preview-dialog.css"

export function FilePreviewDialog(props: { readonly projectID: Project.ID; readonly path: string }): JSX.Element {
  const data = useData()
  const content = data.projectDirectory.content(
    () => props.projectID,
    () => props.path,
    () => classify(props.path).kind !== "unsupported",
  )
  const preview = createMemo(() => filePreview(props.path, content.isPending ? undefined : content.data, content.error))

  const readyFile = () => {
    const state = preview()
    return state.state === "ready" ? state.file : undefined
  }
  const previewError = () => {
    const state = preview()
    return state.state === "error" ? state.message : undefined
  }

  return (
    <Dialog size="large" data-component="file-preview-dialog">
      <DialogHeader>
        <DialogTitle>{props.path}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Switch>
          <Match when={preview().state === "loading"}>
            <div data-slot="file-preview-loading" role="status">
              <Spinner size={32} />
              <p>Loading file…</p>
            </div>
          </Match>
          <Match when={previewError()}>
            {(message) => (
              <>
                <p role="alert">{message()}</p>
                <button
                  type="button"
                  disabled={!data.projectDirectory.ready() || content.isFetching}
                  onClick={() => void content.refetch()}
                >
                  Retry
                </button>
              </>
            )}
          </Match>
          <Match when={readyFile()}>{(file) => <FileViewer file={file()} />}</Match>
        </Switch>
      </DialogBody>
    </Dialog>
  )
}
