import type { Project } from "@bymorning/schema/project"
import { createComponent, Show } from "solid-js"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { createProjectFileListController } from "../features/project-file-list/project-file-list-controller"
import { ProjectFileList } from "../features/project-file-list/project-file-list"
import { FilePreviewDialog } from "./file-preview-dialog"
import "./files-region.css"

export function ProjectFilesRegion(props: { readonly projectID: Project.ID }) {
  return (
    <Show when={props.projectID} keyed>
      {(projectID) => <ProjectFiles projectID={projectID} />}
    </Show>
  )
}

function ProjectFiles(props: { readonly projectID: Project.ID }) {
  const data = useData()
  const dialog = useDialog()
  const directory = data.projectDirectory.observe(() => props.projectID)
  const files = createProjectFileListController({
    projectID: () => props.projectID,
    sourceState: data.projectDirectory.state,
    list: (projectID) => data.projectDirectory.list(projectID).map((path) => ({ path })),
  })

  return (
    <section data-component="home-project-files" aria-labelledby="project-files-heading">
      <button
        type="button"
        disabled={!data.projectDirectory.ready() || directory.isFetching}
        onClick={() => void directory.refetch()}
      >
        Refresh files
      </button>
      <ProjectFileList
        state={files.state()}
        onOpen={(path) => dialog.show(() => createComponent(FilePreviewDialog, { projectID: props.projectID, path }))}
      />
    </section>
  )
}
