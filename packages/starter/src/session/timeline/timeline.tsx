import type { SessionID, Submission } from "@bymorning/client/solid"
import { SessionTimeline, type SessionUI } from "@bymorning/session-ui"
import { useMutation, useMutationState } from "@tanstack/solid-query"
import { createMemo, type Accessor } from "solid-js"
import { errorText } from "@/runtime/error.js"
import { useServer } from "@/runtime/server/runtime.js"
import { timeline } from "./model.js"

type RetryState = {
  readonly submissionID: string | undefined
  readonly status: "idle" | "pending" | "success" | "error"
  readonly error: unknown
  readonly submittedAt: number
}

export function Timeline(props: { readonly sessionID: Accessor<SessionID> }) {
  const server = useServer()
  const rows = createMemo(() =>
    timeline(
      server.data.session.message.list(props.sessionID()),
      server.data.session.inbox.list(props.sessionID()),
      server.data.session.submission.list(props.sessionID()),
    ),
  )
  const history = useMutation(() => ({
    mutationFn: (sessionID: SessionID) => server.data.session.message.load(sessionID),
  }))
  const retry = useMutation(() => ({
    mutationKey: ["session-submission-retry"],
    mutationFn: (submission: Submission) =>
      submission.type === "prompt"
        ? server.data.session.prompt(submission.input)
        : server.data.session.compact(submission.input),
  }))
  const retries = useMutationState<RetryState>(() => ({
    filters: { mutationKey: ["session-submission-retry"], exact: true },
    select: (mutation) => {
      const input = mutation.state.variables
      const submissionID =
        typeof input === "object" && input !== null && "id" in input && typeof input.id === "string"
          ? input.id
          : undefined
      return {
        submissionID,
        status: mutation.state.status,
        error: mutation.state.error,
        submittedAt: mutation.state.submittedAt,
      }
    },
  }))
  const retryAction = (submission: Submission): SessionUI.Operation => {
    const latest = () =>
      retries()
        .filter((state) => state.submissionID === submission.id)
        .sort((left, right) => right.submittedAt - left.submittedAt)[0]
    return {
      pending: () => latest()?.status === "pending",
      error: () => (latest()?.status === "error" ? errorText(latest()?.error) : undefined),
      run: () => retry.mutate(submission),
    }
  }
  const historyAction: SessionUI.Operation = {
    pending: () => history.isPending,
    error: () => (history.error ? errorText(history.error) : undefined),
    run: () => {
      if (!history.isPending) history.mutate(props.sessionID())
    },
  }
  const model: SessionUI.Timeline = {
    sessionID: props.sessionID,
    rows,
    loading: () => server.data.session.message.loading(props.sessionID()),
    error: () => (history.error ? errorText(history.error) : undefined),
    history: { more: () => server.data.session.message.more(props.sessionID()), load: historyAction },
    submission: {
      retry: retryAction,
      dismiss: (submission) => server.data.session.submission.dismiss(submission.sessionID, submission.id),
    },
  }
  return <SessionTimeline {...model} />
}
