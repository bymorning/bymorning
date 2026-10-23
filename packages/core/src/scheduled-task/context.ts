/** Run context written into each Session a Scheduled Task starts. */
export * as RunContext from "./context.js"

import { InstructionEntry } from "@bymorning/schema/instruction-entry"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"

/** Instruction Entry key under which the run context is stored. */
export const Key = InstructionEntry.Key.make("scheduled-task")

/** Explain the unattended situation to the model so it plans the run accordingly. */
export const render = (task: Pick<ScheduledTask.Info, "name" | "cron" | "timezone">, note?: string): string =>
  [
    `This Session was started automatically by the scheduled task "${task.name}" (cron "${task.cron}", time zone ${task.timezone}).`,
    "Nobody is watching it run. You cannot ask the user questions, and a Tool that would need interactive approval is denied rather than asked; work with what is permitted and note anything you could not do.",
    `You have at most ${ScheduledTask.RunSteps} model turns before Tools are withheld. Plan the work to finish well within that and always end with the deliverable the task asks for.`,
    "If there is nothing notable to report, say so briefly.",
    ...(note === undefined ? [] : [note]),
  ].join("\n")
