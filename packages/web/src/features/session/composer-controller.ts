import type { CommandOption, CommandValue } from "../../shell/commands/context"
import type { Data } from "../../context/data"
import type { PromptTarget } from "../../context/prompt-state"
import { createComposerModel } from "./composer-model"
import { createComposerSubmitState } from "./composer-submit"
import type { Controller as SessionController } from "./session-controller"
import type { Accessor } from "solid-js"

import type { SessionSelection } from "./ui/session-selection"
import type { ComposerModel } from "./ui/session-composer"

type Source = {
  readonly data: Pick<SessionController["data"], "detail" | "inbox" | "transcript">
  readonly running?: Accessor<boolean>
  /** An archived Session accepts no messages until it is restored. */
  readonly archived?: Accessor<boolean>
  readonly composer: SessionController["composer"]
  readonly prompt: PromptTarget
  readonly commands: Pick<CommandValue, "register" | "slash">
  readonly projectDirectory: Pick<Data["projectDirectory"], "list" | "search" | "write" | "scope" | "query">
  readonly skills: ComposerModel["skills"]
  readonly agents: ComposerModel["agents"]
  readonly selection: SessionSelection.Model
  readonly selectionVisibility: {
    readonly agent: Accessor<boolean>
    readonly variant: Accessor<boolean>
  }
  readonly subagents?: {
    readonly eligible: Accessor<boolean>
    readonly blocking: Accessor<boolean>
    readonly command: string
    readonly description: string
    readonly error: string
    readonly category: string
  }
}

export function createController(source: Source) {
  const submissionState = createComposerSubmitState()
  const projectScope = () => {
    const detail = source.data.detail()
    return detail.state === "ready" ? detail.data.projectID : undefined
  }
  const command = () => {
    if (source.data.detail().state !== "ready" || source.archived?.()) return undefined
    const transcript = source.data.transcript()
    const active =
      transcript.state === "ready" &&
      transcript.data.some(
        (entry) =>
          entry.activity?.state === "queued" ||
          entry.activity?.state === "running" ||
          entry.activity?.state === "cancelling" ||
          (entry.message.type === "assistant" &&
            entry.message.finish === undefined &&
            entry.message.time.completed === undefined),
      )
    const compacting =
      transcript.state === "ready" &&
      transcript.data.some((entry) => {
        const message = entry.message
        return message.type === "compaction" && message.status === "running"
      })
    return source.running?.() || active || compacting || source.composer.pending()
      ? ("stop" as const)
      : ("submit" as const)
  }
  const canCompact = () => {
    const transcript = source.data.transcript()
    if (transcript.state !== "ready") return false
    const inbox = source.data.inbox?.()
    if (inbox?.state === "ready" && inbox.data.some((item) => item.type === "compaction")) return false
    if (
      transcript.data.some(
        (entry) =>
          entry.message.type === "pending-compaction" ||
          (entry.message.type === "compaction" && entry.message.status === "running"),
      )
    )
      return false
    const boundary = transcript.data.findLastIndex(
      (entry) => entry.message.type === "compaction" && entry.message.status === "completed",
    )
    return transcript.data.slice(boundary + 1).some((entry) => entry.message.type === "user")
  }
  const composer = createComposerModel({
    prompt: source.prompt,
    submissionState,
    adapter: {
      selection: () => {
        const detail = source.data.detail()
        if (detail.state !== "ready") return undefined
        return {
          agent: detail.data.agent,
          model: {
            provider: detail.data.model.provider,
            id: detail.data.model.id,
            ...(detail.data.model.variant === undefined ? {} : { variant: detail.data.model.variant }),
          },
        }
      },
      submit: source.composer.submit,
      interrupt: source.composer.cancel,
      pending: source.composer.pending,
      error: source.composer.error,
    },
    command,
    slashCommands: source.commands.slash,
    selection: source.selection,
    selectionVisibility: source.selectionVisibility,
    projectFiles: {
      scope: projectScope,
      list: () => {
        const scope = projectScope()
        return scope === undefined ? [] : source.projectDirectory.list(scope)
      },
      search: (query, signal) => {
        const detail = source.data.detail()
        if (detail.state !== "ready") return Promise.resolve([])
        return source.projectDirectory.search(detail.data.projectID, query, signal)
      },
    },
    skills: source.skills,
    agents: source.agents,
    write: source.projectDirectory.write,
    directory: source.projectDirectory,
  })
  const compact = async () => {
    if (composer.pending() || !canCompact()) return
    submissionState.setError(undefined)
    try {
      await source.composer.compact()
    } catch {
      /* The native mutation owns the failure. */
    }
  }
  source.commands.register("session", () => {
    const subagents = source.subagents
    const options: CommandOption[] = [
      {
        id: "session.compact",
        title: "Compact session",
        description: "Summarize the session to reduce context size",
        category: "Session",
        disabled: command() === undefined || composer.pending() || !canCompact(),
        slash: "compact",
        onSelect: () => void compact(),
      },
      ...(subagents?.eligible() && subagents.blocking()
        ? [
            {
              id: "session.background",
              title: subagents.command,
              description: subagents.description,
              category: subagents.category,
              keybind: "ctrl+b",
              onSelect: () => {
                submissionState.setError(undefined)
                void source.composer.background().catch(() => undefined)
              },
            },
          ]
        : []),
      {
        id: "session.interrupt",
        title: "Interrupt session",
        keybind: "escape",
        disabled: command() !== "stop" || composer.pending(),
        hidden: true,
        onSelect: () => void composer.stop(),
      },
    ]
    return options
  })
  return composer
}

export type Controller = ReturnType<typeof createController>
