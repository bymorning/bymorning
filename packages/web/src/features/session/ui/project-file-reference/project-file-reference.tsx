import { createEffect, createMemo, createUniqueId, For, Show, type JSX } from "solid-js"

import { editorReferencesMatch, editorSelection, editorText, renderEditor, setEditorSelection } from "./dom-adapter"
import {
  appendEditorHistory,
  cloneAgents,
  createEditorHistory,
  formatProjectFileReference,
  type ProjectAgentReference,
  type ProjectFileReferenceSelection,
  type ProjectReference,
  type ProjectSkillReference,
  referenceAgentID,
  referenceComponent,
  referencePath,
  referenceRanges,
  referenceSkillID,
  referenceTitle,
  recordEditorHistory,
  restoreEditorHistory,
  sameAgents,
  transformAgents,
  transformAgentsForEdit,
} from "./model"
import "./project-file-reference.css"

export type { ProjectAgentReference, ProjectFileReferenceSelection, ProjectSkillReference } from "./model"

export interface ProjectFileReferenceEditorState {
  readonly value: string
  readonly selection: ProjectFileReferenceSelection
  readonly agents: ReadonlyArray<ProjectAgentReference>
}

export interface ProjectFileReferenceEditorHandle {
  readonly focus: () => void
  readonly replace: (
    selection: ProjectFileReferenceSelection,
    text: string,
    agent?: { readonly name: string; readonly text: string },
  ) => void
}

interface EditorProps {
  readonly "data-slot"?: string
  readonly value: string
  readonly cursor: number | undefined
  readonly paths: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<ProjectSkillReference>
  readonly agents?: ReadonlyArray<ProjectAgentReference>
  readonly disabled: boolean
  readonly label: string
  readonly placeholder: string
  readonly maxLength: number
  readonly controls: string | undefined
  readonly expanded: boolean
  readonly activeDescendant: string | undefined
  readonly onStateChange: (state: ProjectFileReferenceEditorState) => void
  readonly onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent>
  readonly onBlur: () => void
  readonly onPasteFiles: (files: FileList) => void
  readonly onEditor: (editor: ProjectFileReferenceEditorHandle) => void
}

interface TextProps {
  readonly value: string
  readonly paths: ReadonlyArray<string>
  readonly skills?: ReadonlyArray<ProjectSkillReference>
  readonly agents?: ReadonlyArray<ProjectAgentReference>
}

export const ProjectFileReference = {
  format: formatProjectFileReference,
  Editor: ProjectFileReferenceEditor,
  Text: ProjectFileReferenceText,
}

function ProjectFileReferenceText(props: TextProps): JSX.Element {
  const parts = createMemo(() => {
    const parts: Array<{
      readonly text: string
      readonly reference?: ProjectReference
    }> = []
    let offset = 0
    for (const reference of referenceRanges(props.value, props.paths, props.skills ?? [], props.agents ?? [])) {
      if (reference.start > offset) parts.push({ text: props.value.slice(offset, reference.start) })
      parts.push({ text: props.value.slice(reference.start, reference.end), reference: reference.reference })
      offset = reference.end
    }
    if (offset < props.value.length) parts.push({ text: props.value.slice(offset) })
    return parts
  })
  return (
    <For each={parts()}>
      {(part) => (
        <Show when={part.reference} fallback={part.text}>
          {(reference) => (
            <span
              data-component={referenceComponent(reference())}
              data-path={referencePath(reference())}
              data-skill-id={referenceSkillID(reference())}
              data-agent-id={referenceAgentID(reference())}
              title={referenceTitle(reference())}
            >
              {part.text}
            </span>
          )}
        </Show>
      )}
    </For>
  )
}

function ProjectFileReferenceEditor(props: EditorProps): JSX.Element {
  const labelID = createUniqueId()
  let element: HTMLDivElement | undefined
  let composing = false
  let localValue = props.value
  let localAgents = cloneAgents(props.agents ?? [])
  const initialCursor = Math.min(props.cursor ?? localValue.length, localValue.length)
  let history = createEditorHistory({
    value: localValue,
    agents: localAgents,
    selection: { start: initialCursor, end: initialCursor },
  })
  let pendingInput: { type: string; selection: ProjectFileReferenceSelection; time: number } | undefined
  const notifyState = (editor: HTMLDivElement) => {
    const value = editorText(editor).slice(0, props.maxLength)
    const selection = editorSelection(editor)
    props.onStateChange({
      value,
      selection: {
        start: Math.min(selection.start, value.length),
        end: Math.min(selection.end, value.length),
      },
      agents: localAgents,
    })
  }
  const restoreHistory = (editor: HTMLDivElement, offset: -1 | 1) => {
    const restored = restoreEditorHistory(history, offset)
    if (!restored) return
    history = restored.history
    localValue = restored.state.value
    localAgents = cloneAgents(restored.state.agents)
    renderEditor(editor, restored.state.value, props.paths, props.skills ?? [], localAgents, restored.state.selection)
    notifyState(editor)
  }
  const sync = (editor: HTMLDivElement) => {
    const selection = editorSelection(editor)
    const value = editorText(editor).slice(0, props.maxLength)
    const nextSelection = {
      start: Math.min(selection.start, value.length),
      end: Math.min(selection.end, value.length),
    }
    if (value !== localValue) {
      const agents =
        pendingInput && pendingInput.selection.start !== pendingInput.selection.end
          ? transformAgentsForEdit(
              localAgents,
              pendingInput.selection,
              Math.max(
                0,
                value.length - (localValue.length - pendingInput.selection.end + pendingInput.selection.start),
              ),
            )
          : transformAgents(localAgents, localValue, value)
      history = recordEditorHistory(history, { value, agents, selection: nextSelection }, pendingInput)
      localAgents = agents
    }
    pendingInput = undefined
    localValue = value
    if (
      editorText(editor) !== value ||
      !editorReferencesMatch(editor, value, props.paths, props.skills ?? [], localAgents)
    )
      renderEditor(editor, value, props.paths, props.skills ?? [], localAgents, nextSelection)
    notifyState(editor)
  }
  const replace = (
    selection: ProjectFileReferenceSelection,
    text: string,
    agent?: { readonly name: string; readonly text: string },
  ) => {
    if (!element) return
    const value = `${localValue.slice(0, selection.start)}${text}${localValue.slice(selection.end)}`.slice(
      0,
      props.maxLength,
    )
    const caret = Math.min(selection.start + text.length, value.length)
    const agents = transformAgentsForEdit(localAgents, selection, Math.min(text.length, value.length - selection.start))
    const mentionEnd = selection.start + (agent?.text.length ?? 0)
    const state = {
      value,
      agents:
        agent && mentionEnd <= value.length
          ? [
              ...agents,
              { name: agent.name, mention: { start: selection.start, end: mentionEnd, text: agent.text } },
            ].sort((left, right) => (left.mention?.start ?? 0) - (right.mention?.start ?? 0))
          : agents,
      selection: { start: caret, end: caret },
    }
    history = appendEditorHistory(history, state)
    localValue = value
    localAgents = state.agents
    pendingInput = undefined
    element.focus()
    renderEditor(element, value, props.paths, props.skills ?? [], localAgents, state.selection)
    notifyState(element)
  }
  createEffect(() => {
    const value = props.value
    const cursor = Math.min(props.cursor ?? value.length, value.length)
    const paths = props.paths
    const skills = props.skills ?? []
    const agents = props.agents ?? []
    if (!element || composing) return
    if (value !== localValue || !sameAgents(agents, localAgents)) {
      localValue = value
      localAgents = cloneAgents(agents)
      history = createEditorHistory({ value, agents: localAgents, selection: { start: cursor, end: cursor } })
      pendingInput = undefined
    }
    const current = editorText(element)
    if (current === value && editorReferencesMatch(element, value, paths, skills, localAgents)) return
    const selection =
      current === value && document.activeElement === element
        ? editorSelection(element)
        : { start: cursor, end: cursor }
    renderEditor(element, value, paths, skills, localAgents, selection)
  })
  return (
    <>
      <span class="sr-only" id={labelID}>
        {props.label}
      </span>
      <div
        ref={(node) => {
          element = node
          props.onEditor({
            focus: () => {
              node.focus()
              const cursor = Math.min(props.cursor ?? props.value.length, props.value.length)
              setEditorSelection(node, cursor)
            },
            replace,
          })
        }}
        id={`${labelID}-editor`}
        data-component="project-file-reference-editor"
        data-slot={props["data-slot"]}
        contentEditable={!props.disabled ? "plaintext-only" : false}
        data-placeholder={props.placeholder}
        spellcheck="true"
        role="combobox"
        aria-labelledby={labelID}
        aria-disabled={props.disabled}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-controls={props.controls}
        aria-expanded={props.expanded}
        aria-activedescendant={props.activeDescendant}
        onBeforeInput={(event) => {
          if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
            event.preventDefault()
            restoreHistory(event.currentTarget, event.inputType === "historyUndo" ? -1 : 1)
            return
          }
          if (composing && pendingInput) return
          pendingInput = {
            type: event.inputType,
            selection: editorSelection(event.currentTarget),
            time: performance.now(),
          }
        }}
        onInput={(event) => {
          if (composing) {
            notifyState(event.currentTarget)
            return
          }
          sync(event.currentTarget)
        }}
        onCompositionStart={() => (composing = true)}
        onCompositionEnd={(event) => {
          composing = false
          sync(event.currentTarget)
        }}
        onClick={(event) => notifyState(event.currentTarget)}
        onKeyUp={(event) => notifyState(event.currentTarget)}
        onMouseUp={(event) => notifyState(event.currentTarget)}
        onBlur={props.onBlur}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return
          if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
            event.preventDefault()
            restoreHistory(event.currentTarget, event.shiftKey ? 1 : -1)
            return
          }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "y") {
            event.preventDefault()
            restoreHistory(event.currentTarget, 1)
            return
          }
          props.onKeyDown(event)
        }}
        onPaste={(event) => {
          const files = event.clipboardData?.files
          if (files && files.length > 0) props.onPasteFiles(files)
        }}
      />
    </>
  )
}
