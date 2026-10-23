import { ErrorBoundary, Suspense, type JSX, type ParentProps } from "solid-js"

import { ErrorPage } from "../app/error-page"
import { useCommand } from "./commands/context"
import { createGlobalCommands } from "./commands/registry/global"
import "./shell.css"
import { Sidebar } from "./sidebar/sidebar"

interface ShellProps extends ParentProps {
  readonly sidebar: (props: { readonly onDismiss: () => void }) => JSX.Element
  readonly layout?: "contained" | "document"
  /** A single-line strip rendered above the routed content on every workspace route. */
  readonly banner?: JSX.Element
}

/** Render persistent application chrome around the active route. */
export default function Shell(props: ShellProps) {
  const command = useCommand()
  command.register("global", createGlobalCommands())
  return (
    <Sidebar
      render={(sidebar) => {
        return (
          <div data-component="shell" data-layout={props.layout ?? "contained"}>
            <div data-slot="shell-body">
              {sidebar.frame}
              <main data-slot="shell-content" tabIndex={-1}>
                <div data-slot="shell-mobile-controls">{sidebar.mobileToggle}</div>
                {props.banner}
                <div data-slot="shell-route-content">
                  <ErrorBoundary fallback={(error, reset) => <ErrorPage error={error} onRetry={reset} />}>
                    <Suspense fallback={null}>{props.children}</Suspense>
                  </ErrorBoundary>
                </div>
              </main>
            </div>
          </div>
        )
      }}
    >
      {(onDismiss) => props.sidebar({ onDismiss })}
    </Sidebar>
  )
}
