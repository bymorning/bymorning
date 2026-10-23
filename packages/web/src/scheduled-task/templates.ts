/** Starting points shown under the task list; each prefills the create dialog. */
export interface Template {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly cron: string
  readonly prompt: string
}

export const templates: ReadonlyArray<Template> = [
  {
    id: "daily-briefing",
    name: "Daily briefing",
    summary: "What needs your attention today across your connected sources.",
    cron: "0 8 * * 1-5",
    prompt: `Prepare my briefing for today.

Look at the last 24 hours across every source available to you (connected tools, calendars, inboxes, issue trackers, and the web for topics I follow). Pull out what needs my attention today: deadlines, decisions waiting on me, meetings that need preparation, and anything that changed since yesterday.

Deliverable: a short brief with three sections — "Needs you today", "Worth knowing", and "Coming up this week". Bullets, at most five per section, each with a one-line reason it matters. Under 300 words.

If nothing meets the bar, say so in a sentence or two. If a source is unavailable or a tool is denied, name it and continue with the rest.`,
  },
  {
    id: "inbox-triage",
    name: "Inbox triage",
    summary: "Categorize new messages and draft replies to anything urgent.",
    cron: "0 8 * * 1-5",
    prompt: `Triage my inbox from the last 24 hours using the connected mail tool.

Group messages into: Urgent (needs a reply today), Waiting on me (reply this week), FYI (no action), and Noise (newsletters, notifications). For each Urgent item, draft a short reply in my voice I can send as-is or edit; do not send anything.

Deliverable: the four groups as headed lists with sender, subject, and a one-line summary, followed by the drafted replies. Keep it under 500 words.

If the mail tool is unavailable, say so and stop. If the inbox is quiet, say so briefly.`,
  },
  {
    id: "meeting-prep",
    name: "Meeting prep",
    summary: "A short brief before each meeting on your calendar today.",
    cron: "30 7 * * 1-5",
    prompt: `Prepare me for today's meetings using my connected calendar.

For each meeting today with other attendees: who is attending and their role, the stated agenda or purpose, relevant recent context you can find (prior threads, documents, decisions), and two or three questions or points I should raise.

Deliverable: one section per meeting in chronological order, each under 120 words, with the meeting time in my time zone as the heading.

Skip meetings with no other attendees. If there are no meetings, say so in one line.`,
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    summary: "A Friday summary of what happened this week and what is due next.",
    cron: "0 16 * * 5",
    prompt: `Write my weekly review covering the last seven days.

Using every source available to you, summarise what was completed, what moved forward, what stalled, and what is due next week. Note decisions made and open questions.

Deliverable: four headed sections — "Completed", "In progress", "Stalled or at risk", "Next week" — with at most six bullets each, then a two-sentence overall assessment. Under 400 words.

If a source is unavailable, name it and continue. If little happened, keep it short rather than padding.`,
  },
  {
    id: "mentions",
    name: "Mentions and assignments",
    summary: "New tickets, reviews, and threads that mention or are assigned to you.",
    cron: "0 8 * * 1-5",
    prompt: `Find everything from the last 24 hours that mentions me or was assigned to me.

Using the connected issue tracker, code review, chat, and document tools, look for new or reassigned tickets, review requests, comments and threads that mention me, and items where I am the owner and a due date is within the next three days.

Deliverable: "Assigned to you", "Waiting on your reply", and "Mentioned" as headed lists. Each bullet has the item ID or title, who raised it, a one-line summary, and a link. Order by urgency. Under 300 words.

If a tool is unavailable or denied, name it and continue with the rest. If nothing mentions me, say so in one sentence.`,
  },
  {
    id: "test-status",
    name: "Test and build status",
    summary: "Overnight test results, build failures, and regressions on your projects.",
    cron: "0 7 * * 1-5",
    prompt: `Summarise overnight test and build results for the projects I work on: [name the projects, repositories, or test suites here].

Using the connected CI, test, and issue tracker tools, cover the last 24 hours: runs completed with pass/fail counts, new failures and regressions compared with the previous run, failures that were fixed, and any blockers such as broken environments or unavailable hardware.

Deliverable: "New failures", "Fixed", and "Blockers" as headed bullet lists, each bullet naming the test or job, a one-line description, and the likely owner if known. End with a one-sentence readiness assessment. Under 300 words.

If the night was clean, say so in one or two sentences. If a source is unavailable, name it and continue.`,
  },
]
