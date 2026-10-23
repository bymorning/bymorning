import type { BudgetLimitInput, BudgetStatusInput, BudgetStatusOutput, ByMorningClient } from "@bymorning/client"
import { useMutation } from "@tanstack/solid-query"
import { postCommit } from "../../utils/post-commit"
import { createEffect, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { Data } from "../../context/data"
import { useData } from "../../context/data"
import { useSDK } from "../../context/sdk"
import { useWorkspace } from "../../context/workspace"
import { useDialog } from "../../context/dialog"
import { Button } from "../../ui/components/button"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import { Hint } from "../../ui/components/hint"
import { Icon } from "../../ui/components/icon"
import { IconButton } from "../../ui/components/icon-button"
import { TextInput } from "../../ui/components/text-input"
import { validateAmount } from "../../ui/amount"
import { formatDollars, formatMonthYear, formatShortDate } from "../../ui/format"
import { showToast } from "../../ui/components/toast"
import { errorMessage } from "../../utils/error-message"
import { WorkspacePage } from "../../home/workspace-page"
import "../page.css"
import "./route.css"

type WorkspaceID = NonNullable<BudgetStatusInput["workspace"]>
type Standing = BudgetStatusOutput["standings"][number]
type UserTarget = Extract<Standing["target"], { type: "user" }>
type ServiceAccountTarget = Extract<Standing["target"], { type: "service_account" }>
type BudgetCatalog = Data["workspace"]["budget"]
type ServiceAccountCatalog = Data["workspace"]["serviceAccount"]
type MemberCatalog = Data["workspace"]["member"]
type Target = BudgetLimitInput["target"]
const targetKey = (target: Target): string =>
  target.type === "workspace"
    ? "workspace"
    : target.type === "user"
      ? `user:${target.userID}`
      : `service_account:${target.serviceAccountID}`

export function GatewayBudgetsRoute(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  return (
    <GatewayBudgetsPage
      workspace={workspace.current().id}
      budget={data.workspace.budget}
      serviceAccount={data.workspace.serviceAccount}
      member={data.workspace.member}
      budgetClient={sdk.client.budget}
    />
  )
}

export function GatewayBudgetsPage(props: {
  readonly workspace: WorkspaceID
  readonly budget: BudgetCatalog
  readonly serviceAccount: ServiceAccountCatalog
  readonly member: MemberCatalog
  readonly budgetClient: Pick<ByMorningClient["budget"], "limit">
}): JSX.Element {
  onMount(
    () =>
      void Promise.all([props.budget.sync(), props.serviceAccount.sync(), props.member.sync()]).catch(() => undefined),
  )
  createEffect(
    on(
      () => {
        const current = props.budget.state()
        return current.state === "error" ? current : undefined
      },
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: () => void props.budget.sync() }],
        })
      },
    ),
  )
  const status = () => props.budget.list()
  const loading = () => {
    const state = props.budget.state().state
    return state === "loading" || state === "idle"
  }
  const standings = () => status()?.standings ?? []
  const standingFor = (target: Target) => {
    const key = targetKey(target)
    return standings().find((standing) => targetKey(standing.target) === key)
  }
  const memberIDs = () =>
    standings().flatMap((standing) => (standing.target.type === "user" ? [standing.target.userID] : []))
  const accountIDs = () =>
    standings().flatMap((standing) =>
      standing.target.type === "service_account" ? [standing.target.serviceAccountID] : [],
    )
  const memberLabel = (userID: UserTarget["userID"]) =>
    props.member.list()?.members.find((entry) => entry.id === userID)?.email ?? userID
  const accountLabel = (serviceAccountID: ServiceAccountTarget["serviceAccountID"]) =>
    props.serviceAccount.list()?.find((entry) => entry.id === serviceAccountID)?.name ?? serviceAccountID
  const workspaceStanding = () => standingFor({ type: "workspace" })

  return (
    <WorkspacePage title="Budgets" layout="table">
      <div data-component="gateway-page">
        <Show when={loading() && status() === undefined}>
          <section data-slot="card" aria-busy="true">
            <p role="status">Loading budgets…</p>
          </section>
        </Show>
        <Show when={status()}>
          {(current) => (
            <>
              <section data-slot="budget-section" aria-labelledby="workspace-budget">
                <div data-slot="budget-section-heading">
                  <h2 id="workspace-budget">Workspace monthly limit</h2>
                  <Hint
                    text={`Spending across the whole workspace for ${formatMonthYear(current().period.start)}. Resets ${formatShortDate(current().period.end)}.`}
                  />
                  <Show when={workspaceStanding()?.limit !== undefined}>
                    <span
                      data-slot="budget-percent"
                      data-state={
                        isOver(workspaceStanding()?.spent ?? 0, workspaceStanding()?.limit ?? 0) ? "over" : undefined
                      }
                    >
                      {usageLabel(workspaceStanding()?.spent ?? 0, workspaceStanding()?.limit ?? 0)}
                    </span>
                  </Show>
                </div>
                <LimitRow
                  workspace={props.workspace}
                  name={() => "Workspace"}
                  target={{ type: "workspace" }}
                  standing={() => standingFor({ type: "workspace" })}
                  client={props.budgetClient}
                  catalog={props.budget}
                />
              </section>

              <section data-slot="budget-section" aria-labelledby="member-budgets" aria-busy={loading()}>
                <div data-slot="budget-section-heading">
                  <h2 id="member-budgets">Member monthly limits</h2>
                  <Hint
                    text={`Each member has their own monthly cap, counted separately from the workspace limit. Resets ${formatShortDate(current().period.end)}.`}
                  />
                </div>
                <Show
                  when={memberIDs().length}
                  fallback={
                    <div data-slot="budget-empty">
                      <p>No member limits.</p>
                    </div>
                  }
                >
                  <div data-slot="budget-account-list">
                    <For each={memberIDs()}>
                      {(userID) => (
                        <LimitRow
                          compact
                          workspace={props.workspace}
                          name={() => memberLabel(userID)}
                          target={{ type: "user", userID }}
                          standing={() => standingFor({ type: "user", userID })}
                          client={props.budgetClient}
                          catalog={props.budget}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              <section data-slot="budget-section" aria-labelledby="account-budgets" aria-busy={loading()}>
                <div data-slot="budget-section-heading">
                  <h2 id="account-budgets">Service account monthly limits</h2>
                  <Hint
                    text={`Each service account has its own monthly cap, counted separately from the workspace limit. Resets ${formatShortDate(current().period.end)}.`}
                  />
                </div>
                <Show
                  when={accountIDs().length}
                  fallback={
                    <div data-slot="budget-empty">
                      <p>No service accounts</p>
                    </div>
                  }
                >
                  <div data-slot="budget-account-list">
                    <For each={accountIDs()}>
                      {(serviceAccountID) => (
                        <LimitRow
                          compact
                          workspace={props.workspace}
                          name={() => accountLabel(serviceAccountID)}
                          target={{ type: "service_account", serviceAccountID }}
                          standing={() => standingFor({ type: "service_account", serviceAccountID })}
                          client={props.budgetClient}
                          catalog={props.budget}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </>
          )}
        </Show>
      </div>
    </WorkspacePage>
  )
}

function LimitRow(props: {
  readonly workspace: WorkspaceID
  readonly name: () => string
  readonly target: Target
  readonly standing: () => Standing | undefined
  readonly compact?: boolean
  readonly client: Pick<ByMorningClient["budget"], "limit">
  readonly catalog: BudgetCatalog
}): JSX.Element {
  const dialog = useDialog()
  const [draft, setDraft] = createStore({
    value: undefined as string | undefined,
    validation: undefined as string | undefined,
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const isCurrent = (workspace: WorkspaceID) => !disposed && props.workspace === workspace
  const mutation = useMutation(() => ({
    retry: false,
    networkMode: "always",
    mutationFn: (input: {
      workspace: WorkspaceID
      target: Target
      amount: number | undefined
      name: string
      client: Pick<ByMorningClient["budget"], "limit">
      catalog: BudgetCatalog
    }) =>
      input.client.limit({
        workspace: input.workspace,
        target: input.target,
        ...(input.amount === undefined ? {} : { amount: input.amount }),
      }),
    onSuccess: (_, input) =>
      postCommit(() => {
        refresh(input.catalog)
        if (disposed || !isCurrent(input.workspace)) return
        setDraft("value", undefined)
        showToast({
          variant: "success",
          title: input.amount === undefined ? `${input.name} limit removed` : `${input.name} limit updated`,
        })
      }),
  }))
  const error = () =>
    draft.validation ?? (mutation.isError ? errorMessage(mutation.error, "Something went wrong.") : undefined)
  createEffect(
    on(
      () => props.workspace,
      () => {
        mutation.reset()
        setDraft({ value: undefined, validation: undefined })
      },
      { defer: true },
    ),
  )
  const confirmRemove = () =>
    dialog.push(() => (
      <ConfirmDialog
        title="Remove limit?"
        description={`Remove the monthly limit for ${props.name()}? Its spending will no longer be capped.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          mutation.reset()
          return mutation.mutateAsync({
            workspace: props.workspace,
            target: props.target,
            amount: undefined,
            name: props.name(),
            client: props.client,
            catalog: props.catalog,
          })
        }}
      />
    ))
  const save = (value: string) => {
    if (mutation.isPending) return
    mutation.reset()
    const validation = validateAmount(value)
    setDraft("validation", validation)
    if (validation) return
    mutation.mutate({
      workspace: props.workspace,
      target: props.target,
      amount: value === "" ? undefined : Number(value),
      name: props.name(),
      client: props.client,
      catalog: props.catalog,
    })
  }
  const standing = () => props.standing()
  const name = () => props.name()
  return (
    <article data-slot="budget-panel" data-empty={standing()?.limit === undefined ? "" : undefined}>
      <div data-slot="budget-panel-row">
        <Show
          when={props.compact}
          fallback={
            <p>
              <strong>{formatDollars(standing()?.spent ?? 0)}</strong> spent this month
              <Show when={standing()?.limit !== undefined}>
                {" "}
                of <strong>{formatDollars(standing()?.limit ?? 0)}</strong> limit
              </Show>
              <Show when={standing()?.limit === undefined}> · No limit</Show>
            </p>
          }
        >
          <div data-slot="budget-account-copy">
            <h3>{name()}</h3>
            <p>
              <strong>{formatDollars(standing()?.spent ?? 0)}</strong> spent this month
              <Show when={standing()?.limit !== undefined}>
                {" "}
                of <strong>{formatDollars(standing()?.limit ?? 0)}</strong> limit
              </Show>
              <Show when={standing()?.limit === undefined}> · No limit</Show>
            </p>
          </div>
        </Show>
        <Show when={draft.value === undefined}>
          <div data-slot="budget-actions">
            <IconButton
              type="button"
              variant="ghost-muted"
              aria-label={standing()?.limit === undefined ? `Set limit for ${name()}` : `Edit limit for ${name()}`}
              title={standing()?.limit === undefined ? `Set limit for ${name()}` : `Edit limit for ${name()}`}
              icon={<Icon name="edit" />}
              onClick={() => setDraft("value", standing()?.limit?.toString() ?? "")}
            />
            <Show when={standing()?.limit !== undefined}>
              <IconButton
                type="button"
                variant="ghost-muted"
                disabled={mutation.isPending}
                aria-label={`Remove limit for ${name()}`}
                title={`Remove limit for ${name()}`}
                icon={<Icon name="archive" />}
                onClick={confirmRemove}
              />
            </Show>
          </div>
        </Show>
      </div>
      <Show when={standing()?.limit !== undefined}>
        <progress
          data-state={isOver(standing()?.spent ?? 0, standing()?.limit ?? 0) ? "over" : undefined}
          value={percentage(standing()?.spent ?? 0, standing()?.limit ?? 0)}
          max="100"
          aria-label={`${formatDollars(standing()?.spent ?? 0)} of ${formatDollars(standing()?.limit ?? 0)} ${name()} limit used${isOver(standing()?.spent ?? 0, standing()?.limit ?? 0) ? " (over limit)" : ""}`}
        />
      </Show>
      <Show when={draft.value !== undefined}>
        <BudgetForm
          compact={props.compact}
          name={name()}
          value={draft.value ?? ""}
          pending={mutation.isPending}
          error={error()}
          canRemove={standing()?.limit !== undefined}
          onInput={(value) => setDraft("value", value)}
          onCancel={() => setDraft("value", undefined)}
          onRemove={confirmRemove}
          onSubmit={(event) => {
            event.preventDefault()
            save(draft.value ?? "")
          }}
        />
      </Show>
      <Show when={draft.value === undefined && error()}>{(message) => <p role="alert">{message()}</p>}</Show>
    </article>
  )
}

const refresh = (...catalogs: ReadonlyArray<{ invalidate(): void; sync(): Promise<void> }>) => {
  for (const catalog of catalogs) {
    catalog.invalidate()
    void catalog.sync().catch(() => undefined)
  }
}

function BudgetForm(props: {
  readonly name: string
  readonly value: string
  readonly pending: boolean
  readonly error: string | undefined
  readonly canRemove: boolean
  readonly compact?: boolean | undefined
  readonly onInput: (value: string) => void
  readonly onCancel: () => void
  readonly onRemove: () => void
  readonly onSubmit: (event: SubmitEvent) => void | Promise<void>
}): JSX.Element {
  let input: HTMLInputElement | undefined
  // The form mounts when editing starts: put the cursor in the amount with its current value selected.
  onMount(() => {
    input?.focus()
    input?.select()
  })
  return (
    <form data-slot="budget-form" noValidate data-compact={props.compact ? "" : undefined} onSubmit={props.onSubmit}>
      <label for={`budget-${props.name}`}>{props.name} monthly limit (USD)</label>
      <div data-slot="budget-form-controls">
        <div data-slot="budget-form-amount">
          <TextInput
            id={`budget-${props.name}`}
            name="budget"
            inputmode="decimal"
            autocomplete="off"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?"
            placeholder="No limit"
            value={props.value}
            numeric
            appearance="full-width"
            inputRef={(element) => (input = element)}
            invalid={!!props.error}
            aria-describedby={props.error ? `budget-${props.name}-error` : undefined}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" size="small" disabled={props.pending}>
          {props.pending ? "Saving…" : "Save"}
        </Button>
        <Show when={props.canRemove}>
          <Button type="button" size="small" variant="ghost-muted" disabled={props.pending} onClick={props.onRemove}>
            Remove
          </Button>
        </Show>
        <Button type="button" size="small" variant="ghost-muted" disabled={props.pending} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
      <Show when={props.error}>
        <p id={`budget-${props.name}-error`} role="alert">
          {props.error}
        </p>
      </Show>
    </form>
  )
}

const isOver = (usage: number, limit: number) => usage > limit

/** Share of the limit consumed, clamped to 0-100; a $0 limit is full only once something is spent. */
const percentage = (usage: number, limit: number) =>
  limit === 0 ? (usage > 0 ? 100 : 0) : Math.min(100, Math.max(0, Math.round((usage / limit) * 100)))

const usageLabel = (usage: number, limit: number) => {
  if (isOver(usage, limit))
    return limit === 0 ? "Over limit" : `Over limit · ${Math.round((usage / limit) * 100)}% used`
  return limit === 0 ? "No room" : `${percentage(usage, limit)}% used`
}
