import { createResource, Show, Suspense, type JSX, type ParentProps } from "solid-js"

import { useServer } from "../../runtime/server/runtime"
import { EmptyShell } from "../empty-shell"

/** Hold the complete workspace shell until its initial catalog bootstrap settles. */
export function BootstrapGate(props: ParentProps): JSX.Element {
  const server = useServer()
  const [status] = createResource(() =>
    server.bootstrap().then(
      () => "ready" as const,
      (cause) => {
        console.error("Session bootstrap failed", cause)
        return "error" as const
      },
    ),
  )

  return (
    <Suspense fallback={<EmptyShell />}>
      <Show when={status()}>{props.children}</Show>
    </Suspense>
  )
}
