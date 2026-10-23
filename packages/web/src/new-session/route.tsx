import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, on, Show, type JSX } from "solid-js"

import { PromptProvider } from "../context/prompt"
import { useWorkspace } from "../context/workspace"
import { useWorkspaceRuntime } from "../context/workspace-runtime"
import { workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { NewSessionScreen } from "./screen"

/** Resolve reload-safe draft metadata within the routed Workspace, replacing missing drafts with Overview. */
export function NewSessionRoute(): JSX.Element {
  const [search] = useSearchParams<{ draftId?: string }>()
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const draft = createMemo(() => (search.draftId ? runtime.draft.get(search.draftId) : undefined))
  const current = createMemo(() => (draft()?.workspaceID === workspace.current().id ? draft() : undefined))
  const missing = () => current() === undefined
  const overview = () => workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview)

  createEffect(
    on(missing, (isMissing) => {
      if (isMissing) navigate(overview(), { replace: true })
    }),
  )

  return (
    <Show
      when={current()}
      keyed
      fallback={
        <p role="status" aria-live="polite" aria-label="This draft cannot be found.">
          This draft cannot be found.
        </p>
      }
    >
      {(resolved) => (
        <PromptProvider scope={{ draftID: resolved.id }}>
          <NewSessionScreen draftID={resolved.id} />
        </PromptProvider>
      )}
    </Show>
  )
}
