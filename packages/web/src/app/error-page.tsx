import type { JSX } from "solid-js"

import { Button } from "../ui/components/button"
import { Textarea } from "../ui/components/textarea"
import "./error-page.css"

interface ErrorPageProps {
  readonly error: unknown
  readonly message?: string
  readonly onRetry: () => void
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return String(error)
}

function isImportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    error.message,
  )
}

/** Render a recoverable application error with user-facing copy and technical details. */
export function ErrorPage(props: ErrorPageProps): JSX.Element {
  const retry = () => {
    if (isImportError(props.error)) {
      window.location.reload()
      return
    }
    props.onRetry()
  }
  return (
    <section data-component="error-page">
      <div data-slot="error-page-content">
        <header data-slot="error-page-summary" role="alert">
          <h1>Something went wrong</h1>
          <p>{props.message ?? "This page could not be displayed."}</p>
        </header>
        <div data-slot="error-page-diagnostic">
          <span data-slot="error-page-label">Error details</span>
          <Textarea
            appearance="diagnostic"
            aria-label="Error details"
            value={formatError(props.error)}
            readOnly
            rows={8}
            spellcheck={false}
          />
        </div>
        <Button type="button" size="large" onClick={retry}>
          Retry
        </Button>
      </div>
    </section>
  )
}
