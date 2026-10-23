import type { InboxItem, Message, Submission } from "@bymorning/client/solid"
import type { SessionUI } from "@bymorning/session-ui"

type OrderedRow = SessionUI.Row & { readonly sequence: number }

/** UI-owned precedence: durable Messages, then admitted Inbox rows, then local Submissions. */
export function timeline(
  messages: readonly Message[],
  inbox: readonly InboxItem[],
  submissions: readonly Submission[],
): readonly SessionUI.Row[] {
  const messageIDs = new Set(messages.map((row) => row.id))
  const inboxIDs = new Set(inbox.map((row) => row.id))
  const server: OrderedRow[] = [
    ...messages.map((message) => ({ type: "message" as const, key: message.id, message, sequence: message.sequence })),
    ...inbox
      .filter((item) => !messageIDs.has(item.id))
      .map((item) => ({ type: "inbox" as const, key: item.id, item, sequence: item.admittedSequence })),
  ].sort((left, right) => left.sequence - right.sequence || left.key.localeCompare(right.key))
  return [
    ...server,
    ...submissions
      .filter((row) => !messageIDs.has(row.id) && !inboxIDs.has(row.id))
      .map((submission) => ({ type: "submission" as const, key: submission.id, submission })),
  ]
}
