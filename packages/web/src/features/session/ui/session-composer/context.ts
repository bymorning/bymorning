import { createContext, useContext, type Accessor } from "solid-js"

import type { ProjectFileReferenceEditorHandle, ProjectFileReferenceEditorState } from "../project-file-reference"
import type { ComposerModel } from "./model"

export interface ComposerCompletion {
  readonly open: Accessor<boolean>
  readonly controls: string
  readonly activeDescendant: Accessor<string | undefined>
  readonly matches: (state: ProjectFileReferenceEditorState) => boolean
  readonly sync: (state: ProjectFileReferenceEditorState) => void
  readonly keydown: (event: KeyboardEvent & { readonly currentTarget: HTMLDivElement }) => boolean
  readonly close: () => void
  readonly trigger?: (trigger: "/" | "@") => boolean
}

export interface ComposerCommands {
  readonly active: Accessor<ComposerCompletion | undefined>
  readonly register: (completion: ComposerCompletion) => () => void
  readonly sync: (state: ProjectFileReferenceEditorState) => void
  readonly keydown: (event: KeyboardEvent & { readonly currentTarget: HTMLDivElement }) => boolean
  readonly close: () => void
  readonly trigger: (trigger: "/" | "@") => void
}

export interface ComposerContext extends Omit<ComposerModel, "slashCommands"> {
  readonly slashCommands: ComposerModel["slashCommands"] | undefined
  readonly editor: Accessor<ProjectFileReferenceEditorHandle | undefined>
  readonly setEditor: (editor: ProjectFileReferenceEditorHandle) => void
  readonly commands: ComposerCommands
}

export const Context = createContext<ComposerContext>()

export function useComposer() {
  const value = useContext(Context)
  if (!value) throw new Error("Composer parts must be inside Composer")
  return value
}
