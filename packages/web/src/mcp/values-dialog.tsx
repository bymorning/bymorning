import type { IntegrationInfo } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import { createEffect, createMemo, For, Match, on, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../context/data"
import { useEntry } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { Field } from "../ui/components/field"
import { Tag } from "../ui/components/tag"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { TextInput } from "../ui/components/text-input"
import { showToast } from "../ui/components/toast"
import { createForm } from "../ui/form"
import { errorMessage } from "../utils/error-message"

import "./values-dialog.css"

type Method = Extract<IntegrationInfo["methods"][number], { readonly type: "values" }>

/**
 * Collect the signed-in member's own values for one MCP server. Values are
 * secret: saved values are never shown, a blank field keeps the saved value,
 * and saving reconnects the server with them to verify they are accepted.
 */
export function MCPValuesDialog(props: {
  /** The server's name when the caller knows it; otherwise it is found from the integration. */
  readonly name?: string
  readonly integrationID: Integration.ID
  readonly onComplete?: () => void
}): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData().workspace
  const entry = useEntry()
  const [state, setState] = createStore<{
    method: Method | undefined
    loading: boolean
    load: string | undefined
    checking: boolean
  }>({ method: undefined, loading: true, load: undefined, checking: false })

  /** The server this integration belongs to, found by integration so a member never needs its name. */
  const server = createMemo(() => data.mcpServer.list()?.find((item) => item.integrationID === props.integrationID))
  const name = () => server()?.name ?? props.name ?? "this server"

  onMount(() => {
    void data.mcpServer.sync().catch(() => undefined)
    const scope = workspace.current().id
    void sdk.client.integration
      .get({ integrationID: props.integrationID, workspace: scope })
      .then((info) => {
        const method = info?.methods.find((item): item is Method => item.type === "values")
        setState({ method, loading: false, load: method === undefined ? "This server does not ask for member values." : undefined })
      })
      .catch((cause) => setState({ loading: false, load: errorMessage(cause, "Could not load this server.") }))
  })

  const saved = (name: string) => state.method?.saved.includes(name) ?? false
  const form = createForm({
    values: { values: {} as Record<string, string> },
    validate: (values) => {
      const missing = (state.method?.fields ?? []).filter((name) => !saved(name) && !values.values[name]?.trim())
      return missing.length === 0 ? undefined : `Enter ${missing.join(", ")}`
    },
    submit: async (values) => {
      const entered = Object.fromEntries(
        Object.entries(values.values).flatMap(([name, value]) => (value.trim() === "" ? [] : [[name, value.trim()]])),
      )
      const scope = workspace.current().id
      await sdk.client.integration.connect.values({ integrationID: props.integrationID, values: entered, workspace: scope })
      // Reconnect now so the status read next reflects these values, not the previous attempt.
      const target = server()?.name ?? props.name
      if (target === undefined) throw new Error("This server is no longer available.")
      await sdk.client.mcp.servers.connect({ server: target, workspace: scope })
      data.mcpServer.invalidate()
      data.mcpTool.invalidate()
      await Promise.all([data.mcpServer.sync(), data.mcpTool.sync()]).catch(() => undefined)
      setState("checking", true)
    },
    fallback: "Could not save your values.",
  })

  // The fields exist only after the integration loads, so the dialog's own first-focus misses them.
  createEffect(
    on(
      () => state.method?.fields[0],
      (first) => {
        if (first === undefined) return
        // One frame later than the dialog's own first-focus, which otherwise lands on Close.
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>('[data-component="form-dialog"] [data-slot="text-input-input"]')
            ?.focus({ preventScroll: true }),
        )
      },
    ),
  )

  /** Saving reconnects the server for this member; its status reports whether the values worked. */
  const outcome = createMemo(() => {
    if (!state.checking) return undefined
    const current = server()
    if (current === undefined || current.status === "pending") return undefined
    if (current.status === "connected") return { type: "connected" as const }
    if (current.status === "failed") return { type: "failed" as const, message: current.error }
    if (current.status === "needs_auth") return { type: "failed" as const, message: "Some values are still missing." }
    return undefined
  })
  createEffect(
    on(outcome, (result) => {
      if (result?.type !== "connected") return
      props.onComplete?.()
      showToast({ variant: "success", title: `Connected ${name()}` })
      entry.close()
    }),
  )

  return (
    <FormDialog
      form={form}
      title={`Connect ${name()}`}
      onSuccess={() => undefined}
      actions={
        <FormFrame.Actions
          submitLabel={state.method?.saved.length ? "Replace values" : "Save values"}
          pendingLabel="Saving…"
          disabled={state.method === undefined || (state.checking && outcome() === undefined)}
        />
      }
    >
      <Switch>
        <Match when={state.loading}>
          <p role="status">Loading…</p>
        </Match>
        <Match when={state.load}>{(message) => <p role="alert">{message()}</p>}</Match>
        <Match when={state.method}>
          {(method) => (
            <FormFrame.Fields>
              <p data-slot="mcp-values-intro">
                These values are yours alone. ByMorning sends them only to {name()} on your requests and never
                shows them again.
              </p>
              <For each={method().fields}>
                {(name) => (
                  <Field>
                    <Field.Label>
                      {name}
                      <Show when={saved(name)}>
                        {" "}
                        <Tag data-slot="mcp-value-saved">Saved</Tag>
                      </Show>
                    </Field.Label>
                    <TextInput
                      type="password"
                      autocomplete="new-password"
                      appearance="full-width"
                      invalid={form.error !== undefined && !saved(name) && !form.values.values[name]?.trim()}
                      disabled={form.pending}
                      placeholder={saved(name) ? "••••••••••••  Leave blank to keep" : undefined}
                      value={form.values.values[name] ?? ""}
                      onInput={(event) => {
                        form.set("values", name, event.currentTarget.value)
                        setState("checking", false)
                      }}
                    />
                  </Field>
                )}
              </For>
              <Show when={state.checking && outcome() === undefined}>
                <p role="status">Checking your values with {name()}…</p>
              </Show>
              <Show when={outcome()?.type === "failed" ? outcome() : undefined}>
                {(result) => (
                  <p role="alert" data-slot="form-error">
                    {(result() as { message: string }).message}
                  </p>
                )}
              </Show>
            </FormFrame.Fields>
          )}
        </Match>
      </Switch>
    </FormDialog>
  )
}
