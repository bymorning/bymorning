/**
 * Suggested Skills an administrator can add to the Workspace library. These are
 * seed content, not a live catalog: adding one creates an ordinary Workspace
 * Skill that the Workspace then owns and can edit or delete.
 */

export type SkillLibraryCategoryID = "analysis" | "decisions" | "operations" | "engineering"

export interface SkillLibraryEntry {
  /** Stable kebab-case entry key, local to this catalog. Max 30 characters. */
  readonly id: string
  readonly category: SkillLibraryCategoryID
  readonly name: string
  readonly description: string
  readonly instructions: string
}

export interface SkillLibraryCategory {
  readonly id: SkillLibraryCategoryID
  readonly label: string
  readonly description: string
}

export const skillLibraryCategories: ReadonlyArray<SkillLibraryCategory> = [
  {
    id: "analysis",
    label: "Analysis and data",
    description: "Turn files and numbers into answers, charts, and dashboards.",
  },
  {
    id: "decisions",
    label: "Decisions and reviews",
    description: "Compare options, review work, and track what a review produced.",
  },
  {
    id: "operations",
    label: "Operations",
    description: "Investigate incidents and write procedures people can follow.",
  },
  {
    id: "engineering",
    label: "Hardware engineering",
    description: "Test campaigns, requirements, interfaces, and nonconformances.",
  },
]
