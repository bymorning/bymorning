import { createSignal, createUniqueId, Show, type JSX } from "solid-js"

import { WorkspaceRoutePath, workspaceIDFromPath, workspaceRouteHref } from "../../../workspace-route-paths"
import type { SessionUI } from "./session-model"
import { useModelPicker } from "./session-selection"
import "./execution-error-card.css"

export function ExecutionErrorCard(props: { readonly failure: SessionUI.ExecutionFailure }): JSX.Element {
  return (
    <Show
      when={props.failure.type === "policy" ? props.failure : undefined}
      fallback={
        <Show
          when={props.failure.type === "provider" ? props.failure : undefined}
          fallback={
            <div class="error-card" role="alert">
              {props.failure.type === "generic" ? props.failure.message : ""}
            </div>
          }
        >
          {(failure) => <ProviderErrorCard failure={failure()} />}
        </Show>
      }
    >
      {(failure) => (
        <section class="error-card policy-error-card" role="alert">
          <h3>Request blocked by policy</h3>
          <p>A Workspace policy prevented {failure().model ?? "the selected model"} from handling this request.</p>
          <dl>
            <Show when={failure().agent}>
              <div>
                <dt>Agent</dt>
                <dd>{failure().agent}</dd>
              </div>
            </Show>
            <Show when={failure().model}>
              <div>
                <dt>Model</dt>
                <dd>{failure().model}</dd>
              </div>
            </Show>
          </dl>
        </section>
      )}
    </Show>
  )
}

function ProviderErrorCard(props: {
  readonly failure: Extract<SessionUI.ExecutionFailure, { type: "provider" }>
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const triggerID = createUniqueId()
  const contentID = createUniqueId()
  const picker = useModelPicker()
  const modelsHref = () => {
    const workspaceID = workspaceIDFromPath(window.location.pathname)
    return workspaceID ? workspaceRouteHref(workspaceID, WorkspaceRoutePath.gatewayModels) : undefined
  }
  return (
    <section class="error-card provider-error-card" role="alert">
      <strong>{props.failure.summary}</strong>
      <p>{props.failure.message}</p>
      <div data-slot="execution-error-card-recovery">
        <button type="button" onClick={() => picker?.open()}>
          Choose a different model
        </button>
        <Show when={modelsHref()}>{(href) => <a href={href()}>Manage models</a>}</Show>
      </div>
      <Show when={props.failure.requestID !== undefined || props.failure.responseBody !== undefined}>
        <div data-slot="execution-error-card-details" data-open={open() ? "true" : "false"}>
          <button
            id={triggerID}
            type="button"
            data-slot="execution-error-card-trigger"
            aria-expanded={open()}
            aria-controls={contentID}
            onClick={() => setOpen((value) => !value)}
          >
            Details
          </button>
          <div
            id={contentID}
            role="region"
            aria-labelledby={triggerID}
            data-slot="execution-error-card-content"
            hidden={!open()}
          >
            <Show when={props.failure.requestID}>{(requestID) => <p>Request ID: {requestID()}</p>}</Show>
            <Show when={props.failure.responseBody}>
              {(responseBody) => (
                <pre>{`${responseBody()}${props.failure.bodyTruncated === true ? "\n… response body truncated" : ""}`}</pre>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
