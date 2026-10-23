import { useSessionUI } from "./session-context"

/** Compose Session data and actions from route-lifetime state. */
export function createController() {
  const session = useSessionUI()
  return {
    data: session.data,
    composer: session.composer,
    history: session.history,
    permission: session.permission,
    form: session.form,
    selection: session.selection,
  }
}

export type Controller = ReturnType<typeof createController>
