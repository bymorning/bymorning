import type { Accessor } from "solid-js"

import type { CommandValue } from "../../../../shell/commands/context"
import type { PromptTarget } from "../../../../context/prompt-state"
import type { createAttachmentController } from "../../attachment-controller"
import type { SessionSelection } from "../session-selection"

export type ComposerAttachment =
  | { readonly id: string; readonly state: "uploading"; readonly path: string }
  | { readonly id: string; readonly state: "ready"; readonly path: string }
  | { readonly id: string; readonly state: "error"; readonly path: string }

export interface ComposerSkill {
  readonly id: string
  readonly name: string
  readonly description: string
}

export interface ComposerAgent {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly mode: "subagent" | "primary" | "all"
  readonly hidden: boolean
}

export interface ComposerModel {
  readonly value: Accessor<string>
  readonly cursor: Accessor<number | undefined>
  readonly error: Accessor<string | undefined>
  readonly pending: Accessor<boolean>
  readonly command: Accessor<"submit" | "stop" | undefined>
  readonly slashCommands?: CommandValue["slash"]
  readonly selection: SessionSelection.Model
  readonly selectionVisibility: {
    readonly agent: Accessor<boolean>
    readonly variant: Accessor<boolean>
  }
  readonly projectFiles: {
    readonly scope: Parameters<typeof createAttachmentController>[0]["scope"]
    readonly list: Accessor<ReadonlyArray<string>>
    readonly search: (query: string, signal: AbortSignal) => Promise<ReadonlyArray<string>>
  }
  readonly skills: Accessor<ReadonlyArray<ComposerSkill> | undefined>
  readonly agents: Accessor<ReadonlyArray<ComposerAgent> | undefined>
  readonly agentAttachments: PromptTarget["agents"]["current"]

  readonly attachments: {
    readonly items: Accessor<ReadonlyArray<ComposerAttachment>>
    readonly disabled: Accessor<boolean>
    readonly add: (files: FileList) => void
    readonly remove: (id: string) => void
  }
  readonly blank: Accessor<boolean>
  readonly restoreFocus: () => void
  readonly edit: PromptTarget["set"]
  readonly submit: () => void | Promise<void>
  readonly stop: () => void | Promise<void>
}
