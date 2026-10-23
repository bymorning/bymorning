import type { Data, SessionID } from "@bymorning/client/solid"
import * as Message from "@bymorning/schema/message"
import { Schema } from "effect"
import { useMutation } from "@tanstack/solid-query"
import type { PromptSubmissionState } from "./prompt-submission-state"

/** Capture the draft once; admission and retry identity belong to shared Data. */
export function createPromptMutation(data: Data, mutationKey: readonly unknown[]) {
  return useMutation(() => ({
    mutationKey,
    retry: false,
    mutationFn: async (input: {
      readonly sessionID: SessionID
      readonly text: string
      readonly submission: PromptSubmissionState
    }) => {
      const target = input.sessionID
      const retry = data.session.submission
        .list(target)
        .findLast(
          (row) =>
            row.type === "prompt" &&
            row.state.state !== "sending" &&
            row.input.delivery === "steer" &&
            row.input.text === input.text &&
            JSON.stringify(row.input.agents ?? []) === JSON.stringify(input.submission.agents),
        )
      const id = retry?.id ?? Schema.decodeUnknownSync(Message.ID)(crypto.randomUUID())
      input.submission.clear()
      try {
        await data.session.prompt({
          sessionID: target,
          id,
          text: input.text,
          agents: input.submission.agents,
          delivery: "steer",
        })
        input.submission.complete()
      } catch (cause) {
        // An admission event can precede a rejected HTTP response. In that case
        // shared Data has retired the Submission: restoring would duplicate it.
        const pending = data.session.submission.list(target).some((row) => row.id === id)
        const admitted =
          data.session.inbox.list(target).some((row) => row.id === id) ||
          data.session.message.get(target, id) !== undefined
        if (pending && !admitted) {
          const restored = input.submission.restore()
          restored?.target.restoreContent(restored.content)
        } else if (admitted || !pending) input.submission.complete()
        throw cause
      }
    },
  }))
}
