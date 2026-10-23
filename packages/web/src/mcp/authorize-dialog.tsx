import { Integration } from "@bymorning/schema/integration"
import { createEffect, createMemo, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useEntry } from "../context/dialog"
import { useIntegration } from "../context/integration"
import { Button } from "../ui/components/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "../ui/components/dialog"
import { Field } from "../ui/components/field"
import { showToast } from "../ui/components/toast"
import { TextInput } from "../ui/components/text-input"

import "./authorize-dialog.css"

const oauthMethod = Integration.MethodID.make("oauth")

export function MCPAuthorizeDialog(props: {
  readonly name: string
  readonly integrationID: Integration.ID
  readonly onComplete?: () => void
}): JSX.Element {
  const integration = useIntegration()
  const entry = useEntry()
  const [store, setStore] = createStore({ code: "" })
  const start = () => void integration.connectOAuth(props.integrationID, oauthMethod, undefined, undefined, "member")
  const flow = () => integration.flow()
  const oauth = createMemo(() => {
    const current = flow()
    return current.state === "oauth" ? current : undefined
  })
  const failed = createMemo(() => {
    const current = flow()
    return current.state === "failed" ? current : undefined
  })
  const authorizationURL = createMemo(() => {
    const current = oauth()
    if (current === undefined || !URL.canParse(current.attempt.url)) return undefined
    const url = new URL(current.attempt.url)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  })
  const title = () => (flow().state === "complete" ? `Connected ${props.name}` : `Connect ${props.name}`)
  const description = () => {
    const current = oauth()
    if (current !== undefined) return current.attempt.instructions
    if (flow().state === "complete") return "The connection is ready to use."
    if (flow().state === "expired") return "The authentication attempt expired."
    if (flow().state === "failed") return "Authentication failed."
    return "Starting authentication…"
  }
  const busy = () => flow().state === "idle" || flow().state === "connecting"

  onMount(start)
  onCleanup(() => integration.reset())
  createEffect(
    on(
      () => flow().state,
      (state) => {
        if (state !== "complete") return
        props.onComplete?.()
        showToast({ variant: "success", title: `Connected ${props.name}` })
        entry.close()
      },
    ),
  )

  return (
    <Dialog fit variant="card" data-component="mcp-authorize-dialog" aria-label={title()} aria-busy={busy()}>
      <DialogHeader>
        <DialogTitleGroup title={title()} description={description()} />
      </DialogHeader>
      <Show when={failed()}>
        {(current) => (
          <p role="alert" data-slot="mcp-authorize-error">
            {current().message}
          </p>
        )}
      </Show>
      <Show when={oauth()?.attempt.mode !== "code" && authorizationURL()}>
        <p role="status" aria-live="polite" class="sr-only">
          Waiting for authorization…
        </p>
      </Show>
      <Show when={oauth()?.attempt.mode === "code"}>
        <DialogBody>
          <Show
            when={authorizationURL()}
            fallback={
              <p role="alert" data-slot="mcp-authorize-error">
                The authorization URL is not safe to open.
              </p>
            }
          >
            <form
              id="mcp-authorize-code"
              data-slot="mcp-authorize-code"
              onSubmit={(event) => {
                event.preventDefault()
                if (!store.code.trim()) return
                const code = store.code.trim()
                setStore("code", "")
                void integration.completeOAuth(code)
              }}
            >
              <Field>
                <Field.Label>Authorization code</Field.Label>
                <TextInput
                  name="code"
                  autocomplete="off"
                  appearance="full-width"
                  required
                  value={store.code}
                  onInput={(event) => setStore("code", event.currentTarget.value)}
                />
              </Field>
            </form>
          </Show>
        </DialogBody>
      </Show>
      <Show when={oauth() && oauth()?.attempt.mode !== "code" && authorizationURL() === undefined}>
        <p role="alert" data-slot="mcp-authorize-error">
          The authorization URL is not safe to open.
        </p>
      </Show>
      <DialogFooter>
        <Switch>
          <Match when={flow().state === "complete"}>
            <Button type="button" size="large" variant="primary" onClick={() => entry.close()}>
              Done
            </Button>
          </Match>
          <Match when={failed() || flow().state === "expired"}>
            <Button type="button" size="large" variant="ghost" onClick={() => entry.dismiss()}>
              Cancel
            </Button>
            <Button type="button" size="large" variant="primary" onClick={start}>
              Retry
            </Button>
          </Match>
          <Match when={oauth()?.attempt.mode === "code"}>
            <Button type="button" size="large" variant="ghost" onClick={() => entry.dismiss()}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="large"
              variant="primary"
              form="mcp-authorize-code"
              disabled={!store.code.trim()}
            >
              Complete connection
            </Button>
          </Match>
          <Match when={authorizationURL()}>
            {(url) => (
              <>
                <Button type="button" size="large" variant="ghost" onClick={() => entry.dismiss()}>
                  Cancel
                </Button>
                <Button as="a" size="large" href={url()} target="_blank" rel="noreferrer" variant="primary">
                  Authorize
                  <span class="sr-only">, opens in a new tab</span>
                </Button>
              </>
            )}
          </Match>
          <Match when={true}>
            <Button type="button" size="large" variant="ghost" onClick={() => entry.dismiss()}>
              Cancel
            </Button>
          </Match>
        </Switch>
      </DialogFooter>
    </Dialog>
  )
}
