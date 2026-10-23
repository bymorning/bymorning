export interface ProjectFileReferenceSelection {
  readonly start: number
  readonly end: number
}

export interface ProjectSkillReference {
  readonly id: string
  readonly name: string
}

export interface ProjectAgentReference {
  readonly name: string
  readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
}

export interface ProjectFileReferenceHistoryState {
  readonly value: string
  readonly agents: ReadonlyArray<ProjectAgentReference>
  readonly selection: ProjectFileReferenceSelection
}

export interface ProjectFileReferencePendingInput {
  readonly type: string
  readonly selection: ProjectFileReferenceSelection
  readonly time: number
}

interface ProjectFileReferenceHistory {
  readonly entries: ReadonlyArray<ProjectFileReferenceHistoryState>
  readonly index: number
  readonly previousInput?: { readonly type: string; readonly time: number }
}

export type ProjectReference =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "skill"; readonly id: string; readonly name: string }
  | { readonly type: "agent"; readonly name: string }

export function formatProjectFileReference(path: string) {
  return /\s|"/.test(path) ? `@"${path.replaceAll('"', '\\"')}"` : `@${path}`
}

export const referencePath = (reference: ProjectReference) => (reference.type === "file" ? reference.path : undefined)
export const referenceSkillID = (reference: ProjectReference) => (reference.type === "skill" ? reference.id : undefined)
export const referenceAgentID = (reference: ProjectReference) =>
  reference.type === "agent" ? reference.name : undefined
export const referenceTitle = (reference: ProjectReference) =>
  reference.type === "skill" || reference.type === "agent" ? reference.name : undefined
export const referenceComponent = (reference: ProjectReference) =>
  reference.type === "file" ? "project-file-reference" : `${reference.type}-reference`

export function referenceRanges(
  text: string,
  paths: ReadonlyArray<string>,
  skills: ReadonlyArray<ProjectSkillReference>,
  agents: ReadonlyArray<ProjectAgentReference>,
) {
  const references = new Map<string, ProjectReference>(
    paths.map((path) => [formatProjectFileReference(path), { type: "file", path }]),
  )
  for (const skill of skills) references.set(`@${skill.id}`, { type: "skill", ...skill })
  const ranges: Array<{
    readonly start: number
    readonly end: number
    readonly reference: ProjectReference
  }> = []

  const structured = agents
    .flatMap((agent) => {
      const mention = agent.mention
      if (
        !mention ||
        !Number.isFinite(mention.start) ||
        !Number.isFinite(mention.end) ||
        !Number.isInteger(mention.start) ||
        !Number.isInteger(mention.end) ||
        mention.start < 0 ||
        mention.end <= mention.start ||
        mention.end > text.length ||
        mention.text !== text.slice(mention.start, mention.end)
      )
        return []
      return [{ agent, mention }]
    })
    .toSorted((left, right) => left.mention.start - right.mention.start || left.mention.end - right.mention.end)
  let structuredEnd = 0
  for (const { agent, mention } of structured) {
    if (mention.start < structuredEnd) continue
    ranges.push({ start: mention.start, end: mention.end, reference: { type: "agent", name: agent.name } })
    structuredEnd = mention.end
  }

  for (let start = text.indexOf("@"); start !== -1; start = text.indexOf("@", start + 1)) {
    if (start > 0 && !/[\s([{'"<]/u.test(text[start - 1]!)) continue
    const end = text[start + 1] === '"' ? quotedReferenceEnd(text, start + 2) : unquotedReferenceEnd(text, start + 1)
    const reference = references.get(text.slice(start, end))
    if (reference !== undefined && !ranges.some((range) => start < range.end && end > range.start))
      ranges.push({ start, end, reference })
  }

  return ranges.sort((left, right) => left.start - right.start || left.end - right.end)
}

function quotedReferenceEnd(text: string, start: number) {
  for (let index = start; index < text.length; index++) {
    if (text[index] === '"' && text[index - 1] !== "\\") return index + 1
  }
  return text.length
}

function unquotedReferenceEnd(text: string, start: number) {
  const offset = text.slice(start).search(/\s/u)
  return offset === -1 ? text.length : start + offset
}

export function transformAgents(agents: ReadonlyArray<ProjectAgentReference>, before: string, after: string) {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let suffix = 0
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++
  return transformAgentsForEdit(agents, { start, end: before.length - suffix }, after.length - start - suffix)
}

export function transformAgentsForEdit(
  agents: ReadonlyArray<ProjectAgentReference>,
  selection: ProjectFileReferenceSelection,
  insertedLength: number,
) {
  const delta = insertedLength - (selection.end - selection.start)
  return agents.flatMap((agent) => {
    const mention = agent.mention
    if (!mention) return [cloneAgent(agent)]
    if (selection.end <= mention.start)
      return [{ ...agent, mention: { ...mention, start: mention.start + delta, end: mention.end + delta } }]
    if (selection.start >= mention.end) return [cloneAgent(agent)]
    return []
  })
}

export function cloneAgent(agent: ProjectAgentReference): ProjectAgentReference {
  return { name: agent.name, ...(agent.mention === undefined ? {} : { mention: { ...agent.mention } }) }
}

export const cloneAgents = (agents: ReadonlyArray<ProjectAgentReference>) => agents.map(cloneAgent)

/** Undo depth; each entry holds the full draft, which can be a long pasted document. */
const historyLimit = 100

export function createEditorHistory(state: ProjectFileReferenceHistoryState): ProjectFileReferenceHistory {
  return { entries: [state], index: 0 }
}

export function restoreEditorHistory(history: ProjectFileReferenceHistory, offset: -1 | 1) {
  const index = history.index + offset
  const state = history.entries[index]
  if (!state) return
  return { history: { ...history, index }, state }
}

export function recordEditorHistory(
  history: ProjectFileReferenceHistory,
  state: ProjectFileReferenceHistoryState,
  pendingInput: ProjectFileReferencePendingInput | undefined,
) {
  const grouped =
    pendingInput !== undefined &&
    history.previousInput?.type === pendingInput.type &&
    pendingInput.time - history.previousInput.time < 750 &&
    pendingInput.selection.start === history.entries[history.index]!.selection.start &&
    pendingInput.selection.end === history.entries[history.index]!.selection.end &&
    (pendingInput.type === "insertText" || pendingInput.type === "deleteContentBackward")
  const entries = history.entries.slice(0, history.index + 1)
  if (!grouped && pendingInput)
    entries[history.index] = {
      value: entries[history.index]!.value,
      agents: entries[history.index]!.agents,
      selection: pendingInput.selection,
    }
  if (grouped) entries[history.index] = state
  if (!grouped) entries.push(state)
  const dropped = Math.max(0, entries.length - historyLimit)
  return {
    entries: dropped === 0 ? entries : entries.slice(dropped),
    index: (grouped ? history.index : history.index + 1) - dropped,
    ...(pendingInput
      ? { previousInput: { type: pendingInput.type, time: pendingInput.time } }
      : history.previousInput
        ? { previousInput: history.previousInput }
        : {}),
  }
}

export function appendEditorHistory(
  history: ProjectFileReferenceHistory,
  state: ProjectFileReferenceHistoryState,
): ProjectFileReferenceHistory {
  const entries = history.entries.slice(0, history.index + 1)
  entries.push(state)
  const dropped = Math.max(0, entries.length - historyLimit)
  return { entries: dropped === 0 ? entries : entries.slice(dropped), index: history.index + 1 - dropped }
}

export function sameAgents(left: ReadonlyArray<ProjectAgentReference>, right: ReadonlyArray<ProjectAgentReference>) {
  return (
    left.length === right.length &&
    left.every((agent, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        agent.name === other.name &&
        agent.mention?.start === other.mention?.start &&
        agent.mention?.end === other.mention?.end &&
        agent.mention?.text === other.mention?.text
      )
    })
  )
}
