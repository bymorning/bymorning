export type SkillListItem = {
  readonly id: string
  readonly name: string
  readonly description?: string | undefined
}

/**
 * Skills the installation contributes rather than the Workspace owning them.
 * They cannot be edited or deleted here and do not count as a library the
 * Workspace has started building.
 */
export const internalSkill = (id: string): boolean =>
  id === "bymorning" || id === "scheduled-task" || id.startsWith("core.")
