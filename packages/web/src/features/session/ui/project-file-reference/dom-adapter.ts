import {
  type ProjectAgentReference,
  type ProjectFileReferenceSelection,
  type ProjectSkillReference,
  referenceComponent,
  referenceRanges,
} from "./model"

export function editorText(editor: HTMLDivElement) {
  return editor.textContent ?? ""
}

export function editorSelection(editor: HTMLDivElement) {
  const selection = document.getSelection()
  const value = editorText(editor)
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !editor.contains(selection.anchorNode) ||
    !editor.contains(selection.focusNode)
  )
    return { start: value.length, end: value.length }

  const anchor = document.createRange()
  anchor.selectNodeContents(editor)
  anchor.setEnd(selection.anchorNode, selection.anchorOffset)
  const focus = document.createRange()
  focus.selectNodeContents(editor)
  focus.setEnd(selection.focusNode, selection.focusOffset)
  const anchorOffset = anchor.toString().length
  const focusOffset = focus.toString().length
  return { start: Math.min(anchorOffset, focusOffset), end: Math.max(anchorOffset, focusOffset) }
}

export function renderEditor(
  editor: HTMLDivElement,
  value: string,
  paths: ReadonlyArray<string>,
  skills: ReadonlyArray<ProjectSkillReference>,
  agents: ReadonlyArray<ProjectAgentReference>,
  selection: ProjectFileReferenceSelection = { start: value.length, end: value.length },
) {
  const fragment = document.createDocumentFragment()
  let offset = 0
  for (const range of referenceRanges(value, paths, skills, agents)) {
    fragment.append(value.slice(offset, range.start))
    const token = document.createElement("span")
    token.dataset.component = referenceComponent(range.reference)
    if (range.reference.type === "file") token.dataset.path = range.reference.path
    if (range.reference.type === "skill") {
      token.dataset.skillId = range.reference.id
      token.title = range.reference.name
    }
    if (range.reference.type === "agent") {
      token.dataset.agentId = range.reference.name
      token.title = range.reference.name
    }
    token.textContent = value.slice(range.start, range.end)
    fragment.append(token)
    offset = range.end
  }
  fragment.append(value.slice(offset))
  editor.replaceChildren(fragment)
  setEditorSelection(editor, selection.start, selection.end)
}

export function editorReferencesMatch(
  editor: HTMLDivElement,
  value: string,
  paths: ReadonlyArray<string>,
  skills: ReadonlyArray<ProjectSkillReference>,
  agents: ReadonlyArray<ProjectAgentReference>,
) {
  const references = referenceRanges(value, paths, skills, agents)
  const tokens = editor.querySelectorAll<HTMLElement>(
    '[data-component="project-file-reference"], [data-component="skill-reference"], [data-component="agent-reference"]',
  )
  if (references.length !== tokens.length || editor.querySelectorAll("*").length !== tokens.length) return false

  return references.every((reference, index) => {
    const token = tokens[index]!
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.setEndBefore(token)
    return (
      token.dataset.component === referenceComponent(reference.reference) &&
      (reference.reference.type === "file"
        ? token.dataset.path === reference.reference.path
        : reference.reference.type === "skill"
          ? token.dataset.skillId === reference.reference.id && token.title === reference.reference.name
          : token.dataset.agentId === reference.reference.name && token.title === reference.reference.name) &&
      range.toString().length === reference.start &&
      token.textContent === value.slice(reference.start, reference.end)
    )
  })
}

export function setEditorSelection(editor: HTMLDivElement, start: number, end = start) {
  const range = document.createRange()
  const selection = document.getSelection()!
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let offset = 0
  let startNode: Node = editor
  let startOffset = 0
  let endNode: Node = editor
  let endOffset = 0

  while (node) {
    const next = offset + (node.textContent?.length ?? 0)
    if (start >= offset && start <= next) {
      startNode = node
      startOffset = start - offset
    }
    if (end >= offset && end <= next) {
      endNode = node
      endOffset = end - offset
      break
    }
    offset = next
    node = walker.nextNode()
  }

  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection.removeAllRanges()
  selection.addRange(range)
}
