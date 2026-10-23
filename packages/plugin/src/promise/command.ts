import type { CommandApi } from "@bymorning/client/promise/api"
import type { Command } from "@bymorning/schema/command"
import type { Types } from "effect"
import type { Transform } from "./registration.js"

export interface CommandEditor {
  list(): readonly Command.Info[]
  get(name: string): Command.Info | undefined
  update(name: string, update: (command: Types.DeepMutable<Command.Info>) => void): void
  remove(name: string): void
}

export interface CommandDomain extends CommandApi {
  readonly transform: Transform<CommandEditor>
  readonly reload: () => Promise<void>
}
