import { define } from "@bymorning/plugin/effect/plugin"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { SkillSchema } from "@bymorning/schema/skill"
import { Effect } from "effect"

/** Guidance for turning a recurring request into a strong, unattended Scheduled Task. */
export const ScheduledTaskSkill = SkillSchema.Info.make({
  id: SkillSchema.ID.make("scheduled-task"),
  name: "Scheduled tasks",
  description:
    "Use when the user wants something done on a schedule or repeatedly: every morning, daily, weekly, on Fridays, monthly, a briefing, a digest, a review, monitoring a topic, or a reminder. Also use to list, change, pause, run, or delete their Scheduled Tasks.",
  instructions: `A Scheduled Task runs a prompt for the user on a cron schedule. Each run starts a new Session as the user, with their Tools and Spend Limits, and nobody is watching it. Manage tasks with the Session Code Mode catalog:

- \`tools.toolkit.schedule.list\` / \`get\` / \`create\` / \`update\` / \`delete\` / \`run\`

## What an unattended run can and cannot do

- Nobody answers during a run. The run cannot ask questions, and any Tool that would need interactive approval is denied instead of asked. Prompts must never say "ask me" or "confirm before".
- A run has at most ${ScheduledTask.RunSteps} model turns before Tools are withheld and it must write its summary. Design the prompt to finish comfortably within that: a few searches or reads, then the deliverable.
- Occurrences must be at least one hour apart; the user may hold at most ${ScheduledTask.MaxPerMember} tasks.
- Runs only happen while ByMorning is running. A run that came due while it was off is recorded as missed and shown to the user, who can run it by hand.
- The result of a run is the Session it creates, titled with the task name. There is no other notification.

## Write the prompt

The prompt is read cold by a model that has no memory of this conversation. Make it self-contained:

1. **Goal and audience** in one sentence: what the run produces and for whom.
2. **Time window relative to the run**, never absolute dates: "the last 24 hours", "since last Monday", "this week". Name the user's time zone when it matters.
3. **Sources**: the exact Tools, sites, feeds, files, or MCP servers to consult (issue trackers, requirements tools, test data, CI, CISA or NVD advisories, regulator sites). If the user named none, ask once which sources to use, or fall back to web search and say so in the prompt.
4. **Scope limits**: what to ignore, how many items at most, what counts as notable.
5. **Deliverable format**: headings, bullets, a table, a draft, a checklist. State the target length.
6. **Quiet-day clause**: "If nothing meets the bar, say so in one or two sentences rather than padding."
7. **Failure clause**: "If a source is unavailable or a Tool is denied, state which and continue with the rest."

Keep the user's own wording and priorities. Do not add tasks they did not ask for.

## Choose the schedule

- Convert plain language to a five-field cron in the user's IANA time zone (\`America/New_York\`, not \`EST\`). Ask for the zone if it is unknown and no earlier context supplies it.
- Weekdays 8:00 → \`0 8 * * 1-5\`; every day 9:00 → \`0 9 * * *\`; Mondays 9:00 → \`0 9 * * 1\`; Fridays 16:00 → \`0 16 * * 5\`; first of the month 9:00 → \`0 9 1 * *\`.
- Prefer the fewest runs that satisfy the request. A digest is daily or weekly, not hourly. Nudge "every hour" toward something slower unless the user insists.
- Pick a moment a little before the user will read it: a briefing for 9:00 runs at 8:30.

## Name it

Two to four words the user will recognise in their Session list: "Test campaign status", "Requirements digest", "Supplier watch", "Design review prep".

## Before you create

Restate the plan in one short paragraph: name, schedule in words with the time zone, and the prompt. Create it only when the user agrees, or immediately when they have already given every detail and asked you to go ahead. After creating, tell the user when it will first run and that each run appears as a new Session with the task's name. Do not read the prompt back again.

## Changing tasks

For "pause", update with \`enabled: false\`; for "resume", \`enabled: true\`. For a schedule change, send the new \`cron\` and \`timezone\`. Use \`run\` when the user wants it now. Confirm before \`delete\`.`,
})

/** Core Scheduled Task Skill plugin. */
export const ScheduledTaskSkillPlugin = define({
  id: "core.skill.scheduled-task",
  effect: (context) => Effect.asVoid(context.skill.transform((editor) => editor.add(ScheduledTaskSkill))),
})
