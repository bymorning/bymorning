import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js"

import { useDialog } from "../../context/dialog"
import { Button } from "../../ui/components/button"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import { ActionMenu } from "../../ui/components/action-menu"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "../../ui/components/dialog"
import { Field } from "../../ui/components/field"
import { Icon } from "../../ui/components/icon"
import { IconButton } from "../../ui/components/icon-button"
import { showToast } from "../../ui/components/toast"
import { TextInput } from "../../ui/components/text-input"
import { Tag } from "../../ui/components/tag"
import { CommandDialog } from "../../app/command-dialog"
import type { IntegrationDialogController } from "./controller"
import { FormFields } from "../../ui/components/form-fields"
import { useDialogFocus, type DialogFocusRefs } from "./use-dialog-focus"
import "./dialog.css"

export function IntegrationDialogView(props: {
  readonly controller: IntegrationDialogController
  readonly onEnable?: () => void | Promise<unknown>
  readonly enablePending?: boolean
}): JSX.Element {
  const refs: DialogFocusRefs = {
    backButton: undefined,
    applicationBack: undefined,
    keyInput: undefined,
    awsInput: undefined,
    codeInput: undefined,
    doneButton: undefined,
    applicationInput: undefined,
    clientForm: undefined,
    applicationStatus: undefined,
    selectedAction: undefined,
    renameRail: undefined,
  }
  const clientMethods = () => props.controller.methods().filter((method) => method.type === "oauth" && method.client)
  const clientOnly = () => props.controller.methods().length === 1 && clientMethods().length === 1
  const dialog = useDialog()
  const confirmRemove = (connection: {
    readonly id: Parameters<IntegrationDialogController["remove"]>[0]
    readonly label: string
  }) =>
    dialog.push(() => (
      <ConfirmDialog
        title="Remove connection?"
        description={`Remove ${connection.label}? Models that depend on this connection stop working until another is connected.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => props.controller.remove(connection.id)}
      />
    ))
  const unverified = () =>
    props.controller.store.methodType === "key" || props.controller.store.methodType === "aws-sigv4"
  const nestedEscapes = new WeakSet<Event>()
  const [selectedCredentialID, setSelectedCredentialID] = createSignal<string>()
  const credentials = createMemo(() =>
    props.controller
      .displayConnections()
      .filter((connection) => connection.type === "credential" || connection.type === "regional-credential"),
  )
  const selectedCredential = createMemo(() => {
    const available = credentials()
    return (
      available.find((connection) => connection.id === selectedCredentialID()) ??
      available.find((connection) => connection.id === props.controller.activeCredentialID()) ??
      available[0]
    )
  })

  const options = () =>
    props.controller.catalog().map((item) => {
      const labels = item.connections
        .map((connection) =>
          connection.type === "credential" || connection.type === "regional-credential"
            ? connection.label
            : connection.type === "env"
              ? connection.name
              : `Environment · ${connection.region}`,
        )
        .join(", ")
      return {
        id: item.id,
        title: item.name,
        description: item.id.startsWith("mcp-")
          ? item.methods.some((method) => method.type === "values")
            ? "Enter your own values"
            : "Sign in with your account"
          : item.id,
        category: item.id.startsWith("mcp-")
          ? "MCP servers"
          : props.controller.websearchIDs().has(item.id)
            ? "Web search"
            : "Services",
        ...(labels ? { meta: `Connected · ${labels}` } : {}),
        onSelect: () => props.controller.select(item),
      }
    })
  const emptyState = (
    <Switch>
      <Match when={props.controller.list().state === "loading" || props.controller.list().state === "idle"}>
        <span role="status">Loading integrations…</span>
      </Match>
      <Match when={true}>No integrations found</Match>
    </Switch>
  )
  const title = () => {
    const name = props.controller.selected()?.name
    if (
      props.controller.store.view === "key" ||
      props.controller.store.view === "aws-sigv4" ||
      props.controller.store.view === "oauth" ||
      props.controller.store.view === "command"
    ) {
      return `Connect ${name}`
    }
    return name
  }

  createEffect(
    on(
      () => {
        const state = props.controller.list()
        // The picker's empty slot is the only place the list error was shown inline.
        return props.controller.store.view === "picker" && state.state === "error" ? state : undefined
      },
      (state) =>
        state &&
        showToast({
          variant: "error",
          title: state.message,
          actions: [{ label: "Try again", onClick: () => void props.controller.refetch() }],
        }),
    ),
  )
  useDialogFocus(props.controller, refs, selectedCredential)

  return (
    <Switch>
      <Match when={props.controller.store.view === "picker"}>
        <CommandDialog
          closeOnSelect={false}
          label="Connect an integration"
          placeholder="Search integrations"
          options={options}
          empty={emptyState}
        />
      </Match>
      <Match when={true}>
        <Dialog
          fit
          size={props.controller.providerOnly ? "normal" : "large"}
          onEscapeKeyDown={(event) => {
            if (nestedEscapes.has(event)) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            const menu = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menu"]') : null
            if (menu) {
              nestedEscapes.add(event)
              const trigger = document.getElementById(menu.getAttribute("aria-labelledby") ?? "")
              setTimeout(() => {
                if (menu.hasAttribute("data-closed")) menu.setAttribute("aria-hidden", "true")
                trigger?.focus({ preventScroll: true })
              }, 50)
              return
            }
            event.preventDefault()
            event.stopPropagation()
            props.controller.back()
          }}
          data-component="integration-dialog"
        >
          <DialogHeader hideClose>
            <div data-slot="integration-dialog-header">
              <IconButton
                ref={(element) => (refs.backButton = element)}
                type="button"
                variant="ghost-muted"
                aria-label="Go back"
                onClick={props.controller.back}
                icon={<Icon name="arrow-left" />}
              />
              <DialogTitle>{title()}</DialogTitle>
              <span data-slot="integration-dialog-close">
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  aria-label="Close"
                  onClick={props.controller.close}
                  icon={<Icon name="close" />}
                />
              </span>
            </div>
          </DialogHeader>
          <DialogBody>
            <div data-slot="integration-dialog-body">
              <Switch>
                <Match when={props.controller.flow().state === "connecting"}>
                  <div data-slot="integration-dialog-waiting" role="status" aria-live="polite">
                    <p>Starting authentication…</p>
                  </div>
                </Match>
                <Match when={props.controller.oauthFlow()}>
                  {(flow) => (
                    <div data-slot="integration-dialog-authentication">
                      <p>{flow().attempt.instructions}</p>
                      <Show
                        when={props.controller.authorizationURL()}
                        fallback={<p role="alert">The authorization URL is not safe to open.</p>}
                      >
                        {(url) => (
                          <>
                            <div data-slot="integration-dialog-oauth-actions">
                              <Button as="a" href={url()} target="_blank" rel="noreferrer" variant="primary">
                                Authorize
                              </Button>
                              <Show when={flow().attempt.mode !== "code"}>
                                <p role="status" aria-live="polite">
                                  Waiting for authorization…
                                </p>
                              </Show>
                            </div>
                            <Show when={flow().attempt.mode === "code"}>
                              <form onSubmit={(event) => void props.controller.completeOAuth(event)}>
                                <Field>
                                  <Field.Label>Authorization code</Field.Label>
                                  <TextInput
                                    ref={(element) => (refs.codeInput = element)}
                                    name="code"
                                    autocomplete="off"
                                    appearance="full-width"
                                    required
                                    value={props.controller.store.code}
                                    onInput={(event) => props.controller.setStore("code", event.currentTarget.value)}
                                  />
                                </Field>
                                <Button type="submit" variant="primary" disabled={!props.controller.store.code.trim()}>
                                  Complete connection
                                </Button>
                              </form>
                            </Show>
                          </>
                        )}
                      </Show>
                    </div>
                  )}
                </Match>
                <Match when={props.controller.commandFlow()}>
                  {(flow) => (
                    <div data-slot="integration-dialog-authentication">
                      <p role="status" aria-live="polite">
                        Waiting for the authentication command…
                      </p>
                      <pre data-slot="integration-dialog-progress">{flow().progress}</pre>
                    </div>
                  )}
                </Match>
                <Match when={props.controller.failedFlow()}>
                  {(flow) => (
                    <div data-slot="integration-dialog-authentication">
                      <p role="alert" data-component="integration-dialog-error">
                        {flow().message}
                      </p>
                      <Button type="button" onClick={props.controller.back}>
                        Back
                      </Button>
                    </div>
                  )}
                </Match>
                <Match when={props.controller.flow().state === "expired"}>
                  <div data-slot="integration-dialog-authentication">
                    <p role="alert">The authentication attempt expired.</p>
                    <Button type="button" onClick={props.controller.back}>
                      Back
                    </Button>
                  </div>
                </Match>
                <Match when={props.controller.store.view === "connection"}>
                  <Switch>
                    <Match when={props.controller.detail().state === "loading"}>
                      <p role="status">Loading connection details…</p>
                    </Match>
                    <Match when={props.controller.detail().state === "error"}>
                      <p role="alert" data-component="integration-dialog-error">
                        {props.controller.detailError()}
                      </p>
                    </Match>
                    <Match when={props.controller.selected() === null}>
                      <p role="alert">This integration is no longer available.</p>
                    </Match>
                    <Match when={props.controller.selected() !== undefined}>
                      <div data-slot="integration-dialog-connections">
                        <section
                          data-slot="integration-dialog-connection-section"
                          aria-labelledby="connected-keys-title"
                        >
                          <h3 id="connected-keys-title">Connected Keys</h3>
                          <Show
                            when={props.controller.selected()!.connections.length > 0}
                            fallback={<p data-slot="integration-dialog-empty">Not connected</p>}
                          >
                            <ul data-slot="integration-dialog-connection-list">
                              <For each={props.controller.displayConnections()}>
                                {(connection) => {
                                  const credential =
                                    connection.type === "credential" || connection.type === "regional-credential"
                                      ? connection
                                      : undefined
                                  const selected = () =>
                                    credential !== undefined && credential.id === selectedCredential()?.id
                                  const content = (
                                    <span data-slot="integration-dialog-connection-label">
                                      <span>
                                        <strong>
                                          {connection.type === "credential" || connection.type === "regional-credential"
                                            ? connection.label
                                            : connection.type === "env"
                                              ? connection.name
                                              : connection.type === "regional-deployment"
                                                ? "AWS deployment"
                                                : "Environment"}
                                        </strong>
                                        <Show
                                          when={
                                            (connection.type === "credential" ||
                                              connection.type === "regional-credential") &&
                                            props.controller.isPrimary(connection)
                                          }
                                        >
                                          <Tag>Primary</Tag>
                                        </Show>
                                        <Show when={!props.controller.providerOnly && credential?.scope}>
                                          <small>
                                            {credential?.scope === "member"
                                              ? "Your connection"
                                              : "Workspace connection"}
                                          </small>
                                        </Show>
                                        <Show
                                          when={
                                            connection.type === "regional-credential" ||
                                            connection.type === "regional-env" ||
                                            connection.type === "regional-deployment"
                                          }
                                        >
                                          <small>
                                            {connection.type === "regional-credential" ||
                                            connection.type === "regional-env" ||
                                            connection.type === "regional-deployment"
                                              ? `${connection.type === "regional-deployment" ? "AWS credential chain" : connection.authKind === "sigv4" ? "AWS access keys" : "Bedrock API key"} · ${connection.region}`
                                              : ""}
                                          </small>
                                        </Show>
                                        <Show when={connection.type === "env" || connection.type === "regional-env"}>
                                          <small>Environment</small>
                                        </Show>
                                      </span>
                                    </span>
                                  )
                                  return (
                                    <li data-selected={selected() ? "" : undefined}>
                                      <Show when={credential} fallback={content}>
                                        {(saved) => (
                                          <>
                                            <button
                                              type="button"
                                              data-slot="integration-dialog-connection-select"
                                              aria-pressed={selected()}
                                              disabled={props.controller.mutation().state === "loading"}
                                              onClick={() => setSelectedCredentialID(saved().id)}
                                            >
                                              {content}
                                            </button>
                                            <Show
                                              when={
                                                selected() &&
                                                props.controller.store.renameID !== saved().id &&
                                                (saved().scope === "member" || props.controller.canShareWorkspace())
                                              }
                                            >
                                              <span
                                                ref={(element) => (refs.selectedAction = element)}
                                                data-slot="integration-dialog-connection-actions"
                                              >
                                                <ActionMenu
                                                  label={saved().label}
                                                  disabled={props.controller.mutation().state === "loading"}
                                                >
                                                  <ActionMenu.Item
                                                    disabled={props.controller.isPrimary(saved())}
                                                    onSelect={() => void props.controller.activate(saved().id)}
                                                  >
                                                    Make primary
                                                  </ActionMenu.Item>
                                                  <ActionMenu.Item
                                                    onSelect={() =>
                                                      props.controller.setStore({
                                                        renameID: saved().id,
                                                        renameLabel: saved().label,
                                                      })
                                                    }
                                                  >
                                                    Rename
                                                  </ActionMenu.Item>
                                                  <ActionMenu.Separator />
                                                  <ActionMenu.Item
                                                    class="danger"
                                                    onSelect={() => confirmRemove(saved())}
                                                  >
                                                    Remove connection
                                                  </ActionMenu.Item>
                                                </ActionMenu>
                                              </span>
                                            </Show>
                                          </>
                                        )}
                                      </Show>
                                    </li>
                                  )
                                }}
                              </For>
                            </ul>
                          </Show>
                        </section>
                        <Show when={props.controller.mutation().state === "error"}>
                          <p role="alert" data-component="integration-dialog-error">
                            {props.controller.mutationError()}
                          </p>
                        </Show>
                        <Show when={props.controller.mutation().state === "success"}>
                          <p role="status" data-component="integration-dialog-success-message">
                            {props.controller.store.mutationMessage}
                          </p>
                        </Show>
                        <For each={clientMethods()}>
                          {(method) => {
                            if (method.type !== "oauth" || !method.client) return null
                            return (
                              <section data-slot="integration-dialog-oauth-client-status">
                                <Show when={!clientOnly()}>
                                  <strong>{method.label}</strong>
                                </Show>
                                <Show when={method.client?.configured || props.controller.canShareWorkspace()}>
                                  <Button
                                    type="button"
                                    aria-label={
                                      method.client.configured
                                        ? `Connect with ${method.label}`
                                        : `Configure ${method.label} OAuth client`
                                    }
                                    variant={clientOnly() ? "primary" : "neutral"}
                                    onClick={() => props.controller.choose(method)}
                                  >
                                    {method.client?.configured ? "Connect" : "Set up connection"}
                                  </Button>
                                </Show>
                                <Show when={method.client?.configured && props.controller.canShareWorkspace()}>
                                  <p>Removing this configuration may require reconnecting existing connections.</p>
                                  <Button
                                    type="button"
                                    aria-label={`Replace ${method.label} OAuth client configuration`}
                                    disabled={props.controller.clientMutation().state === "loading"}
                                    onClick={() => {
                                      props.controller.choose(method)
                                      props.controller.chooseOAuthClient("replace")
                                    }}
                                  >
                                    Replace configuration
                                  </Button>
                                  <Button
                                    type="button"
                                    aria-label={`Remove ${method.label} OAuth client configuration`}
                                    variant="danger"
                                    disabled={props.controller.clientMutation().state === "loading"}
                                    onClick={() => {
                                      props.controller.choose(method)
                                      void props.controller.removeOAuthClient()
                                    }}
                                  >
                                    Remove configuration
                                  </Button>
                                </Show>
                              </section>
                            )
                          }}
                        </For>
                        <Show when={props.controller.clientMessage()}>
                          <p role="status" aria-live="polite">
                            {props.controller.clientMessage()}
                          </p>
                        </Show>
                        <Show
                          when={props.controller.methods().length > 0}
                          fallback={
                            <p data-slot="integration-dialog-note">
                              This integration has no supported connection method.
                            </p>
                          }
                        >
                          <Show when={!clientOnly()}>
                            <Button type="button" variant="primary" onClick={props.controller.add}>
                              Add connection
                            </Button>
                          </Show>
                        </Show>
                        <DeploymentActivation {...props} />
                      </div>
                    </Match>
                  </Switch>
                </Match>
                <Match when={props.controller.store.view === "method"}>
                  <div data-slot="integration-dialog-methods">
                    <p>Choose how to connect {props.controller.selected()?.name}.</p>
                    <For each={props.controller.methods()}>
                      {(method) => (
                        <Button type="button" onClick={() => props.controller.choose(method)}>
                          {method.type === "key" ? (method.label ?? "API key") : method.label}
                        </Button>
                      )}
                    </For>
                    <DeploymentActivation {...props} />
                  </div>
                </Match>
                <Match when={props.controller.store.view === "oauth-client"}>
                  <form
                    data-slot="integration-dialog-client-form"
                    ref={(element) => (refs.clientForm = element)}
                    onSubmit={(event) => void props.controller.submitOAuthClient(event)}
                  >
                    <Show when={!props.controller.providerOnly}>
                      <p>Shared with your workspace. Saved credentials stay hidden.</p>
                    </Show>
                    <Show when={props.controller.store.clientMode === "replace"}>
                      <p role="alert">
                        Changing the OAuth client ID can invalidate existing refresh tokens. You may need to reconnect
                        existing connections.
                      </p>
                    </Show>
                    <FormFields
                      appearance="full-width"
                      fields={props.controller.clientForm()}
                      answers={props.controller.store.clientAnswers}
                      firstRef={(element) => (refs.applicationInput = element)}
                      set={(key, value) =>
                        props.controller.setStore("clientAnswers", (answers) => ({ ...answers, [key]: value }))
                      }
                    />
                    <Show when={props.controller.clientMessage()}>
                      <p
                        ref={(element) => (refs.applicationStatus = element)}
                        tabindex="-1"
                        role={
                          props.controller.clientMutation().state === "success" ||
                          props.controller.clientMutation().state === "loading"
                            ? "status"
                            : "alert"
                        }
                        aria-live="polite"
                      >
                        {props.controller.clientMessage()}
                        <Show when={props.controller.clientMutation().state === "commit-unknown"}>
                          {" Refresh status or retry explicitly."}
                        </Show>
                      </p>
                    </Show>
                    <Show
                      when={
                        props.controller.clientMutation().state === "committed-refresh-failed" ||
                        props.controller.clientMutation().state === "commit-unknown"
                      }
                    >
                      <Button type="button" onClick={() => void props.controller.retryClientConfigurationRefresh()}>
                        Refresh status
                      </Button>
                    </Show>
                    <Show when={props.controller.clientMutation().state === "commit-unknown"}>
                      <Button
                        type="button"
                        disabled={(() => {
                          const mutation = props.controller.clientMutation()
                          return (
                            !props.controller.clientMethodAvailable() ||
                            (mutation.state === "commit-unknown" &&
                              mutation.operation.kind === "put" &&
                              !props.controller.clientForm().length)
                          )
                        })()}
                        onClick={() => void props.controller.retryUnknownClientConfigurationMutation()}
                      >
                        {(() => {
                          const mutation = props.controller.clientMutation()
                          if (mutation.state !== "commit-unknown") return "Retry"
                          if (mutation.operation.kind === "delete") return "Retry removal"
                          return mutation.operation.mode === "replace" ? "Retry replacement" : "Retry configuration"
                        })()}
                      </Button>
                      <Button
                        ref={(element: HTMLButtonElement) => (refs.applicationBack = element)}
                        type="button"
                        onClick={props.controller.back}
                      >
                        Back
                      </Button>
                    </Show>
                    <Show
                      when={
                        props.controller.clientMutation().state !== "commit-unknown" &&
                        props.controller.clientMutation().state !== "committed-refresh-failed" &&
                        props.controller.store.clientMode !== undefined
                      }
                    >
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={
                          props.controller.clientMutation().state === "loading" ||
                          props.controller.clientValidity() !== undefined
                        }
                      >
                        {props.controller.clientMutation().state === "loading"
                          ? "Saving…"
                          : props.controller.store.clientMode === "replace"
                            ? "Replace configuration"
                            : "Save OAuth client"}
                      </Button>
                    </Show>
                  </form>
                </Match>
                <Match when={props.controller.store.view === "key" || props.controller.store.view === "oauth"}>
                  <form
                    id={props.controller.providerOnly ? "provider-connection-form" : undefined}
                    data-slot="integration-dialog-key-form"
                    onSubmit={(event) => void props.controller.submit(event)}
                  >
                    <p>
                      Add {props.controller.store.view === "key" ? "a key" : "an OAuth"} connection for{" "}
                      {props.controller.selected()?.name}.
                    </p>
                    <Show when={!props.controller.providerOnly}>
                      <ConnectionScope controller={props.controller} />
                    </Show>
                    <Show
                      when={
                        props.controller.store.view === "oauth" &&
                        props.controller.clientConfigured() &&
                        props.controller.canShareWorkspace()
                      }
                    >
                      <section data-slot="integration-dialog-oauth-client-status">
                        <p>Removing this configuration may require reconnecting existing connections.</p>
                        <Button
                          type="button"
                          aria-label={`Replace ${props.controller.selectedMethodLabel()} client configuration`}
                          disabled={props.controller.clientMutation().state === "loading"}
                          onClick={() => props.controller.chooseOAuthClient("replace")}
                        >
                          Replace configuration
                        </Button>
                        <Button
                          type="button"
                          aria-label={`Remove ${props.controller.selectedMethodLabel()} client configuration`}
                          variant="danger"
                          disabled={props.controller.clientMutation().state === "loading"}
                          onClick={() => void props.controller.removeOAuthClient()}
                        >
                          {props.controller.clientMutation().state === "loading" ? "Removing…" : "Remove configuration"}
                        </Button>
                      </section>
                    </Show>
                    <Show when={props.controller.store.view === "oauth" && props.controller.clientMessage()}>
                      <p
                        ref={(element) => (refs.applicationStatus = element)}
                        tabindex="-1"
                        role="status"
                        aria-live="polite"
                      >
                        {props.controller.clientMessage()}
                      </p>
                    </Show>
                    <Show when={props.controller.store.view === "key"}>
                      <Field>
                        <Field.Label>API key</Field.Label>
                        <TextInput
                          ref={(element) => {
                            refs.keyInput = element
                            setTimeout(() => element.focus({ preventScroll: true }))
                          }}
                          autofocus
                          name="key"
                          type="password"
                          autocomplete="off"
                          appearance="full-width"
                          required
                          value={props.controller.store.key}
                          onInput={(event) => props.controller.setStore("key", event.currentTarget.value)}
                        />
                        <Show when={props.controller.store.key.length > 0 && !props.controller.store.key.trim()}>
                          <p role="alert" data-component="integration-dialog-error">
                            Enter an API key. Spaces alone are not a valid key.
                          </p>
                        </Show>
                      </Field>
                    </Show>
                    <FormFields
                      appearance="full-width"
                      fields={props.controller.form()}
                      answers={props.controller.store.answers}
                      set={(key, value) =>
                        props.controller.setStore("answers", (answers) => ({ ...answers, [key]: value }))
                      }
                    />
                    <Show when={!props.controller.providerOnly}>
                      <Field>
                        <Field.Label>
                          Label <span data-slot="integration-dialog-optional">(optional)</span>
                        </Field.Label>
                        <TextInput
                          name="label"
                          appearance="full-width"
                          value={props.controller.store.label}
                          onInput={(event) => props.controller.setStore("label", event.currentTarget.value)}
                        />
                      </Field>
                    </Show>
                    <Show when={props.controller.mutation().state === "error"}>
                      <p role="alert" data-component="integration-dialog-error">
                        {props.controller.mutationError()}
                      </p>
                    </Show>
                    <Show when={props.controller.store.validationMessage}>
                      {(message) => (
                        <p role="alert" data-component="integration-dialog-error">
                          {message()}
                        </p>
                      )}
                    </Show>
                    <Show when={!props.controller.providerOnly}>
                      <FormActions controller={props.controller} />
                    </Show>
                  </form>
                </Match>
                <Match when={props.controller.store.view === "aws-sigv4"}>
                  <form
                    id={props.controller.providerOnly ? "provider-connection-form" : undefined}
                    data-slot="integration-dialog-aws-form"
                    onSubmit={(event) => void props.controller.submitAws(event)}
                  >
                    <p>Add an AWS access key connection for {props.controller.selected()?.name}.</p>
                    <Show when={!props.controller.providerOnly}>
                      <ConnectionScope controller={props.controller} />
                    </Show>
                    <Field>
                      <Field.Label>AWS access key ID</Field.Label>
                      <TextInput
                        ref={(element) => {
                          refs.awsInput = element
                          setTimeout(() => element.focus({ preventScroll: true }))
                        }}
                        autofocus
                        name="accessKeyId"
                        type="password"
                        autocomplete="new-password"
                        appearance="full-width"
                        required
                        value={props.controller.store.accessKeyId}
                        onInput={(event) => props.controller.setStore("accessKeyId", event.currentTarget.value)}
                      />
                    </Field>
                    <Field>
                      <Field.Label>AWS secret access key</Field.Label>
                      <TextInput
                        name="secretAccessKey"
                        type="password"
                        autocomplete="new-password"
                        appearance="full-width"
                        required
                        value={props.controller.store.secretAccessKey}
                        onInput={(event) => props.controller.setStore("secretAccessKey", event.currentTarget.value)}
                      />
                    </Field>
                    <Field>
                      <Field.Label>
                        AWS session token <span data-slot="integration-dialog-optional">(optional)</span>
                      </Field.Label>
                      <TextInput
                        name="sessionToken"
                        type="password"
                        autocomplete="new-password"
                        appearance="full-width"
                        value={props.controller.store.sessionToken}
                        onInput={(event) => props.controller.setStore("sessionToken", event.currentTarget.value)}
                      />
                    </Field>
                    <FormFields
                      appearance="full-width"
                      fields={
                        props.controller
                          .selected()
                          ?.methods.flatMap((method) =>
                            method.type === "aws-sigv4" && method.id === props.controller.store.methodID
                              ? [method.region]
                              : [],
                          ) ?? []
                      }
                      answers={props.controller.store.answers}
                      set={(key, value) =>
                        props.controller.setStore("answers", (answers) => ({ ...answers, [key]: value }))
                      }
                    />
                    <Show when={!props.controller.providerOnly}>
                      <Field>
                        <Field.Label>
                          Label <span data-slot="integration-dialog-optional">(optional)</span>
                        </Field.Label>
                        <TextInput
                          name="label"
                          appearance="full-width"
                          value={props.controller.store.label}
                          onInput={(event) => props.controller.setStore("label", event.currentTarget.value)}
                        />
                      </Field>
                    </Show>
                    <Show when={props.controller.mutation().state === "error"}>
                      <p role="alert" data-component="integration-dialog-error">
                        {props.controller.mutationError()}
                      </p>
                    </Show>
                    <Show when={props.controller.store.validationMessage}>
                      {(message) => (
                        <p role="alert" data-component="integration-dialog-error">
                          {message()}
                        </p>
                      )}
                    </Show>
                    <Show when={!props.controller.providerOnly}>
                      <FormActions controller={props.controller} />
                    </Show>
                  </form>
                </Match>
                <Match when={props.controller.store.view === "command"}>
                  <form
                    id={props.controller.providerOnly ? "provider-connection-form" : undefined}
                    data-slot="integration-dialog-command-form"
                    onSubmit={(event) => void props.controller.submitCommand(event)}
                  >
                    <p>Run the authentication command for {props.controller.selected()?.name}.</p>
                    <Show when={!props.controller.providerOnly}>
                      <ConnectionScope controller={props.controller} />
                      <Field>
                        <Field.Label>
                          Label <span data-slot="integration-dialog-optional">(optional)</span>
                        </Field.Label>
                        <TextInput
                          name="label"
                          appearance="full-width"
                          value={props.controller.store.label}
                          onInput={(event) => props.controller.setStore("label", event.currentTarget.value)}
                        />
                      </Field>
                    </Show>
                    <Show when={!props.controller.providerOnly}>
                      <div data-slot="integration-dialog-form-actions">
                        <Button type="submit" variant="primary">
                          Run command
                        </Button>
                      </div>
                    </Show>
                  </form>
                </Match>
                <Match when={props.controller.store.view === "success"}>
                  <div data-slot="integration-dialog-success" role="status">
                    <span>
                      <Icon name="check" />
                    </span>
                    <Show
                      when={unverified()}
                      fallback={
                        <>
                          <h3>Connected {props.controller.selected()?.name}</h3>
                          <p>The connection is ready to use.</p>
                        </>
                      }
                    >
                      <h3>Saved {props.controller.selected()?.name} connection</h3>
                      <p>The key is stored but has not been checked. It is first verified when a model uses it.</p>
                    </Show>
                    <Button
                      ref={(element: HTMLButtonElement) => (refs.doneButton = element)}
                      type="button"
                      variant="primary"
                      onClick={props.controller.close}
                    >
                      Done
                    </Button>
                  </div>
                </Match>
              </Switch>
            </div>
          </DialogBody>
          <ProviderFormActions controller={props.controller} />
          <Show
            when={
              props.controller.store.view === "connection" &&
              props.controller.store.renameID === selectedCredential()?.id
                ? selectedCredential()
                : undefined
            }
          >
            {(credential) => (
              <DialogFooter>
                <div data-slot="integration-dialog-footer">
                  <div ref={(element) => (refs.renameRail = element)} data-slot="integration-dialog-action-rail">
                    <div data-slot="integration-dialog-rename-field">
                      <TextInput
                        autofocus
                        appearance="full-width"
                        aria-label={`Rename ${credential().label}`}
                        value={props.controller.store.renameLabel}
                        onInput={(event) => props.controller.setStore("renameLabel", event.currentTarget.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      disabled={
                        !props.controller.store.renameLabel.trim() || props.controller.mutation().state === "loading"
                      }
                      onClick={() => void props.controller.rename(credential().id)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={props.controller.mutation().state === "loading"}
                      onClick={() => props.controller.setStore({ renameID: undefined, renameLabel: "" })}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </DialogFooter>
            )}
          </Show>
        </Dialog>
      </Match>
    </Switch>
  )
}

function FormActions(props: { readonly controller: IntegrationDialogController }) {
  const keyMissing = () => props.controller.store.view === "key" && !props.controller.store.key.trim()
  const awsMissing = () =>
    props.controller.store.view === "aws-sigv4" &&
    (!props.controller.store.accessKeyId.trim() || !props.controller.store.secretAccessKey.trim())
  return (
    <div data-slot="integration-dialog-form-actions">
      <Button
        type="submit"
        variant="primary"
        disabled={keyMissing() || awsMissing() || props.controller.mutation().state === "loading"}
      >
        {props.controller.mutation().state === "loading" ? "Connecting…" : "Connect"}
      </Button>
    </div>
  )
}

function ProviderFormActions(props: { readonly controller: IntegrationDialogController }) {
  const formView = () =>
    props.controller.providerOnly &&
    props.controller.flow().state === "idle" &&
    (props.controller.store.view === "key" ||
      props.controller.store.view === "oauth" ||
      props.controller.store.view === "aws-sigv4" ||
      props.controller.store.view === "command")
  const keyMissing = () => props.controller.store.view === "key" && !props.controller.store.key.trim()
  const awsMissing = () =>
    props.controller.store.view === "aws-sigv4" &&
    (!props.controller.store.accessKeyId.trim() || !props.controller.store.secretAccessKey.trim())
  const pending = () => props.controller.mutation().state === "loading"
  return (
    <Show when={formView()}>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={pending()} onClick={props.controller.close}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="provider-connection-form"
          variant="primary"
          disabled={keyMissing() || awsMissing() || pending()}
        >
          {props.controller.store.view === "command" ? "Run command" : pending() ? "Connecting…" : "Connect"}
        </Button>
      </DialogFooter>
    </Show>
  )
}

function DeploymentActivation(props: {
  readonly controller: IntegrationDialogController
  readonly onEnable?: () => void | Promise<unknown>
  readonly enablePending?: boolean
}) {
  return (
    <Show when={props.controller.providerOnly && props.onEnable}>
      <div data-slot="integration-dialog-deployment-activation">
        <p>
          Enable Bedrock using this deployment&apos;s AWS credential chain. Credentials are resolved when a model is
          invoked.
        </p>
        <Button type="button" disabled={props.enablePending} onClick={() => void props.onEnable?.()}>
          {props.enablePending ? "Enabling…" : "Use deployment AWS credentials"}
        </Button>
      </div>
    </Show>
  )
}

function ConnectionScope(props: { readonly controller: IntegrationDialogController }) {
  return (
    <Show
      when={props.controller.selected()?.connectionPolicy !== "member-only" && props.controller.canShareWorkspace()}
      fallback={<p>This connection belongs to you. Each teammate connects their own account.</p>}
    >
      <Field>
        <Field.Label>Connection access</Field.Label>
        <select
          aria-label="Connection access"
          value={props.controller.store.scope}
          onChange={(event) =>
            props.controller.setStore("scope", event.currentTarget.value === "member" ? "member" : "workspace")
          }
        >
          <option value="workspace">Workspace — shared with teammates</option>
          <option value="member">Personal — only you</option>
        </select>
      </Field>
    </Show>
  )
}
