import { isShareNotFoundError, type ShareView } from "@bymorning/client"
import { useParams } from "@solidjs/router"
import { createEffect, on, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSDK } from "../context/sdk"
import { SharePage } from "./page"

/** Share Tokens are UUIDs; skip the request entirely for anything else. */
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Fetch the public Share view and render it with the Session workspace UI. */
export function ShareRoute(): JSX.Element {
  const { client } = useSDK()
  const params = useParams<{ workspaceID: string; token: string }>()
  const [state, setState] = createStore({
    status: "loading" as "loading" | "ready" | "notFound" | "invalid" | "error",
    title: "",
    messages: [] as ShareView["messages"],
    error: "",
  })
  createEffect(
    on(
      () => [params.workspaceID, params.token] as const,
      ([workspaceID, token]) => {
        setState({ status: "loading", title: "", messages: [], error: "" })
        if (!tokenPattern.test(token)) {
          setState("status", "invalid")
          return
        }
        const controller = new AbortController()
        void client["server.share"]
          .get(
            {
              workspaceID: workspaceID as ShareView["workspaceID"],
              token: token as ShareView["token"],
            },
            { signal: controller.signal },
          )
          .then((view) => {
            if (controller.signal.aborted) return
            setState({ status: "ready", title: view.title, messages: view.messages, error: "" })
          })
          .catch((cause: unknown) => {
            if (controller.signal.aborted) return
            if (isShareNotFoundError(cause)) setState("status", "notFound")
            else setState({ status: "error", error: errorMessage(cause) })
          })
        onCleanup(() => controller.abort())
      },
    ),
  )
  return (
    <SharePage status={state.status} title={state.title} messages={state.messages} error={state.error} />
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : "Share is unavailable."
}
