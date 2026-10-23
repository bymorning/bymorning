import type { Project } from "@bymorning/schema/project"
import type { Transform } from "./registration.js"

export interface InstructionFile {
  path: string
  content: string
  projectID?: Project.ID
}

export interface InstructionEditor {
  list(): readonly InstructionFile[]
  add(file: InstructionFile): void
  update(path: string, projectID: Project.ID | undefined, update: (file: InstructionFile) => void): void
  remove(path: string, projectID: Project.ID | undefined): void
  unavailable(): void
}

export interface InstructionDomain {
  readonly list: (projectID?: Project.ID) => Promise<readonly InstructionFile[]>
  readonly transform: Transform<InstructionEditor>
  readonly reload: () => Promise<void>
}
