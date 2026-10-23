import { Show, type JSX } from "solid-js"

import { NewSessionComposerRegion } from "../features/session/ui/session-composer-region"
import { SessionBackdrop } from "./backdrop"
import type { NewSessionDraftController } from "./controller"
import { NewSessionProjectPicker } from "./project-picker"
import "./view.css"
import { AddProviderButton } from "../integration/providers/view"
import { Button } from "../ui/components/button"

export function NewSessionView(props: { readonly controller: NewSessionDraftController }): JSX.Element {
  return (
    <section data-component="new-session-view">
      <div data-slot="new-session-view-content">
        <SessionBackdrop />
        <h1 class="sr-only">New session</h1>
        <ProviderSetup controller={props.controller} />
        <NewSessionComposerRegion composer={props.controller.composer}>
          <NewSessionProjectPicker controller={props.controller} />
        </NewSessionComposerRegion>
      </div>
    </section>
  )
}

function ProviderSetup(props: { readonly controller: NewSessionDraftController }) {
  const state = () => props.controller.provider.catalog.activation()
  const modelState = () => props.controller.provider.models.state()
  const empty = () => {
    const current = state()
    return current.state === "empty" ? current : undefined
  }
  const refresh = () => {
    const current = state()
    return current.state === "empty" || current.state === "ready" ? current.refresh : undefined
  }
  const noModels = () => {
    if (state().state !== "ready") return false
    const current = modelState()
    return "refreshedAt" in current && current.refreshedAt !== undefined && props.controller.provider.models.count() === 0
  }
  const visible = () => state().state !== "ready" || noModels() || refresh()?.state !== "idle"
  return (
    <Show when={visible()}>
      <aside data-component="provider-setup" aria-labelledby="provider-setup-title">
        <Show when={state().state === "loading"}>
          <p role="status">Checking providers…</p>
        </Show>
        <Show when={state().state === "error"}>
          <p role="alert">Could not load providers.</p>
          <Button onClick={() => void props.controller.provider.retry().catch(() => undefined)}>Retry</Button>
        </Show>
        <Show when={state().state === "empty"}>
          <h2 id="provider-setup-title">Activate a provider to start chatting</h2>
          <p>Add a provider connection or enable a configured provider.</p>
          <Show
            when={props.controller.provider.access() === "admin"}
            fallback={<p>Ask a workspace administrator to activate a provider.</p>}
          >
            <AddProviderButton catalog={props.controller.provider.catalog} owner={props.controller.provider.owner} />
          </Show>
          <Show when={empty()?.refresh.state === "loading"}>
            <p role="status">Refreshing providers…</p>
          </Show>
          <Show when={empty()?.refresh.state === "error"}>
            <p>Could not refresh providers.</p>
            <Button onClick={() => void props.controller.provider.retry().catch(() => undefined)}>Retry</Button>
          </Show>
        </Show>
        <Show when={noModels()}>
          <h2 id="provider-setup-title">No models available</h2>
          <Show
            when={props.controller.provider.access() === "admin"}
            fallback={<p>Ask a workspace administrator to manage available models.</p>}
          >
            <p>Manage provider connections, activation, and model availability to start chatting.</p>
            <Button as="a" href={props.controller.provider.manage()}>Manage models</Button>
          </Show>
        </Show>
        <Show when={state().state === "ready" && !noModels() && refresh()?.state !== "idle"}>
          <h2 id="provider-setup-title" class="sr-only">Provider status</h2>
        </Show>
        <Show when={state().state === "ready" && refresh()?.state === "loading"}>
          <p role="status">Refreshing providers…</p>
        </Show>
        <Show when={state().state === "ready" && refresh()?.state === "error"}>
          <p>Could not refresh providers.</p>
          <Button onClick={() => void props.controller.provider.retry().catch(() => undefined)}>Retry</Button>
        </Show>
      </aside>
    </Show>
  )
}
