import type { ByMorningClient, ModelRouteOutput } from "@bymorning/client"
import { Config } from "@bymorning/schema/config"
import { Provider } from "@bymorning/schema/provider"
import type * as Workspace from "@bymorning/schema/workspace"
import { useNavigate, useParams } from "@solidjs/router"
import { Option, Schema } from "effect"
import { createMemo, Index, Match, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Collapsible } from "../ui/components/collapsible"
import { Empty } from "../ui/components/empty"
import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { Field } from "../ui/components/field"
import { Icon } from "../ui/components/icon"
import { IconButton } from "../ui/components/icon-button"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"
import { Textarea } from "../ui/components/textarea"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import { useLeaveGuard } from "../console/leave-guard"
import { AUTO, autoModels, NAME, type AutoModel } from "./auto"
import { createModelPicks, ModelPicker, modelValue, type CatalogModel } from "./model-picker"
import type { RoutingRule } from "./rule-dialog"
import { insertRoute } from "./routing"
import { createRoutingStore, type ConfigClient } from "./store"
import "./route.css"

type RouteClient = ByMorningClient["model"]["route"]

const CAUSE_LABELS: Record<string, string> = {
  none: "no rule matched",
  rule: "rule matched",
  judge: "chosen by the judge",
  pinned: "reused for this turn",
  fallback: "default tier",
}

const policiesHref = (workspaceID: string) => `/w/${workspaceID}/policies`
export const autoModelHref = (workspaceID: string, name?: string) =>
  `/w/${workspaceID}/policies/auto${name === undefined ? "" : `/${encodeURIComponent(name)}`}`

/** Console → Model routing → one Auto model. */
export function AutoModelRoute(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  const params = useParams<{ name?: string }>()
  const navigate = useNavigate()
  onMount(() => void data.workspace.model.sync().catch(() => undefined))
  return (
    <Show when={params.name ?? "\u0000new"} keyed>
      {(key) => (
        <AutoModelPage
          workspaceID={workspace.current().id}
          {...(key === "\u0000new" ? {} : { name: key })}
          client={sdk.client["api.config"]}
          route={(input) => sdk.client.model.route(input)}
          models={() => data.workspace.model.rows().map((row) => row.info)}
          leave={useLeaveGuard}
          open={(name) => navigate(autoModelHref(workspace.current().id, name), { replace: true })}
          back={() => navigate(policiesHref(workspace.current().id))}
        />
      )}
    </Show>
  )
}

/** Full-page editor for one Auto model: its Tiers, default Tier, judge, and a routing test. */
export function AutoModelPage(props: {
  readonly workspaceID: Workspace.ID
  /** The Auto name being edited; absent when creating one. */
  readonly name?: string
  readonly client: ConfigClient
  readonly route?: RouteClient
  readonly models: () => ReadonlyArray<CatalogModel>
  /** Registers a guard that confirms before navigation discards unsaved changes. */
  readonly leave?: (dirty: () => boolean) => void
  readonly open: (name: string) => void
  readonly back: () => void
}): JSX.Element {
  const routing = createRoutingStore({ client: props.client, workspaceID: props.workspaceID })
  onMount(() => void routing.refresh())
  const entry = () =>
    props.name === undefined ? undefined : autoModels(routing.rules()).find((item) => item.name === props.name)

  return (
    <Switch>
      <Match when={routing.state.phase === "loading" && routing.state.config === undefined}>
        <WorkspacePage title={props.name ?? "New Auto model"}>
          <p role="status" data-slot="policies-status">
            Loading…
          </p>
        </WorkspacePage>
      </Match>
      <Match when={routing.state.phase === "error" && routing.state.config === undefined}>
        <WorkspacePage title={props.name ?? "New Auto model"}>
          <div data-slot="policies-error">
            <p role="alert">{routing.state.loadError ?? "Could not load routes."}</p>
            <Button type="button" variant="ghost" onClick={() => void routing.refresh()}>
              Try again
            </Button>
          </div>
        </WorkspacePage>
      </Match>
      <Match when={props.name !== undefined && entry() === undefined}>
        <WorkspacePage
          title="Auto model not found"
          back={{ href: policiesHref(props.workspaceID), label: "Model routing" }}
        >
          <Empty>No Auto model named {props.name} exists in this Workspace.</Empty>
        </WorkspacePage>
      </Match>
      <Match when={true}>
        <AutoModelEditor {...props} routing={routing} initial={entry()} />
      </Match>
    </Switch>
  )
}

interface TierDraft {
  name: string
  key: string
  description: string
}

function AutoModelEditor(
  props: Parameters<typeof AutoModelPage>[0] & {
    readonly routing: ReturnType<typeof createRoutingStore>
    readonly initial: AutoModel | undefined
  },
): JSX.Element {
  const dialog = useDialog()
  const catalog = createModelPicks(props.models)
  const tiers = props.initial?.rule.to
  const initial = {
    name: props.initial?.name ?? "",
    tiers: (tiers?.tiers.map((tier) => ({
      name: tier.name,
      key: catalog.remember(tier.model),
      description: tier.description,
    })) ?? [
      { name: "fast", key: "", description: "" },
      { name: "capable", key: "", description: "" },
    ]) as TierDraft[],
    defaultTier: tiers?.default ?? "fast",
    judgeKey: catalog.remember(tiers?.judge.model),
    instructions: tiers?.judge.instructions ?? "",
    timeout: tiers?.judge.timeout?.toString() ?? "",
    window: tiers?.judge.window?.toString() ?? "",
  }
  const [draft, setDraft] = createStore(structuredClone(initial))
  const [status, setStatus] = createStore<{
    saved: string
    error: string | undefined
    trialPrompt: string
    trialPending: boolean
    trialResult: ModelRouteOutput | undefined
    trialError: string | undefined
  }>({
    saved: JSON.stringify(initial),
    error: undefined,
    trialPrompt: "",
    trialPending: false,
    trialResult: undefined,
    trialError: undefined,
  })
  const dirty = () => JSON.stringify(draft) !== status.saved
  props.leave?.(dirty)
  const creating = () => props.name === undefined
  const pending = () => props.routing.state.pending
  const tierNames = () => draft.tiers.map((tier) => tier.name.trim()).filter((name) => name !== "")

  const integer = (value: string) => {
    const trimmed = value.trim()
    if (trimmed === "") return undefined
    const parsed = Number(trimmed)
    return Number.isInteger(parsed) ? parsed : Number.NaN
  }

  const problem = createMemo(() => {
    if (!NAME.test(draft.name.trim()))
      return "Name the Auto model with lowercase letters, digits, hyphens, or underscores."
    if (draft.tiers.length === 0) return "Add at least one tier."
    const names = draft.tiers.map((tier) => tier.name.trim())
    if (names.some((name) => !NAME.test(name)))
      return "Name each tier with lowercase letters, digits, hyphens, or underscores."
    if (new Set(names).size !== names.length) return "Tier names must be unique."
    if (draft.tiers.some((tier) => catalog.find(tier.key) === undefined)) return "Choose a model for each tier."
    if (draft.tiers.some((tier) => tier.description.trim() === "")) return "Describe when each tier should be used."
    if (!names.includes(draft.defaultTier)) return "Choose the default tier."
    if (catalog.find(draft.judgeKey) === undefined) return "Choose the judge model."
    const timeout = integer(draft.timeout)
    if (Number.isNaN(timeout) || (timeout !== undefined && (timeout < 100 || timeout > 30_000)))
      return "Enter a judge timeout between 100 and 30000 milliseconds."
    const window = integer(draft.window)
    if (Number.isNaN(window) || (window !== undefined && (window < 0 || window > 10)))
      return "Enter between 0 and 10 earlier messages."
    return undefined
  })

  const rule = (): RoutingRule | undefined => {
    if (problem() !== undefined) return undefined
    const timeout = integer(draft.timeout)
    const window = integer(draft.window)
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(Config.Routing)({
        match: { model: { provider: AUTO, id: draft.name.trim() } },
        to: {
          tiers: draft.tiers.map((tier) => ({
            name: tier.name.trim(),
            model: modelValue(catalog.find(tier.key)),
            description: tier.description.trim(),
          })),
          default: draft.defaultTier,
          judge: {
            model: modelValue(catalog.find(draft.judgeKey)),
            ...(draft.instructions.trim() === "" ? {} : { instructions: draft.instructions.trim() }),
            ...(timeout === undefined ? {} : { timeout }),
            ...(window === undefined ? {} : { window }),
          },
        },
      }),
    )
  }

  const save = async () => {
    const next = rule()
    if (next === undefined) return setStatus("error", problem() ?? "Check the Auto model's values.")
    const name = draft.name.trim()
    // What is sent is what becomes saved; edits made while the request is in flight stay dirty.
    const sent = JSON.stringify(draft)
    setStatus("error", undefined)
    try {
      await props.routing.persist((current) => {
        const models = autoModels(current)
        const existing = props.name === undefined ? undefined : models.find((item) => item.name === props.name)
        if (props.name !== undefined && existing === undefined)
          throw new Error("This Auto model was removed. Return to Model routing and try again.")
        if (models.some((item) => item.name === name && item !== existing))
          throw new Error(`An Auto model named ${name} already exists.`)
        if (existing === undefined) return insertRoute(current, next)
        return current.map((item, index) => (index === existing.index ? next : item))
      })
      setStatus({ saved: sent, trialResult: undefined })
      showToast({ variant: "success", title: creating() ? "Auto model created" : "Auto model saved" })
      if (name !== props.name) props.open(name)
    } catch (cause) {
      setStatus("error", errorMessage(cause, "The Auto model could not be saved."))
    }
  }

  const remove = () => {
    const name = props.name
    if (name === undefined) return
    dialog.show(() => (
      <ConfirmDialog
        title="Delete Auto model?"
        description={`Sessions, Agents, Scheduled Tasks, and Gateway callers that select ${AUTO}/${name} will fail until another rule matches it.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await props.routing.persist((current) => {
            const existing = autoModels(current).find((item) => item.name === name)
            return existing === undefined ? [...current] : current.filter((_, index) => index !== existing.index)
          })
          setStatus("saved", JSON.stringify(draft))
          showToast({ variant: "success", title: "Auto model deleted" })
          props.back()
        }}
      />
    ))
  }

  const runTrial = async () => {
    const name = props.name
    if (props.route === undefined || name === undefined || status.trialPrompt.trim() === "" || status.trialPending)
      return
    setStatus({ trialPending: true, trialError: undefined, trialResult: undefined })
    try {
      const result = await props.route({
        workspace: props.workspaceID,
        model: { provider: Provider.Name.make(AUTO), id: name },
        prompt: status.trialPrompt,
      })
      if (!props.routing.disposed()) setStatus("trialResult", result)
    } catch (cause) {
      if (!props.routing.disposed()) setStatus("trialError", errorMessage(cause, "Routing could not be tested."))
    } finally {
      if (!props.routing.disposed()) setStatus("trialPending", false)
    }
  }

  const modelName = (ref: { readonly provider: string; readonly id: string }) =>
    props.models().find((model) => model.provider === ref.provider && model.id === ref.id)?.name ??
    `${ref.provider}/${ref.id}`
  const move = (from: number, to: number) =>
    setDraft("tiers", (current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })

  const title = () => (creating() ? "New Auto model" : `${AUTO}/${props.name}`)
  return (
    <WorkspacePage
      title={title()}
      back={{ href: policiesHref(props.workspaceID), label: "Model routing" }}
      description="Members and Gateway callers select this name. A judge model sends each request to the cheapest tier that fits."
      actions={
        <>
          <Show when={!creating()}>
            <Button type="button" variant="ghost" disabled={pending()} onClick={remove}>
              Delete
            </Button>
          </Show>
          <Button
            type="button"
            variant="primary"
            disabled={pending() || (!creating() && !dirty())}
            onClick={() => void save()}
          >
            {pending() ? "Saving…" : creating() ? "Create Auto model" : "Save changes"}
          </Button>
        </>
      }
    >
      <div data-component="auto-model">
        <Show when={status.error}>
          {(message) => (
            <p role="alert" data-slot="auto-error">
              {message()}
            </p>
          )}
        </Show>

        <section data-slot="auto-section" aria-label="Name">
          <div data-slot="auto-section-copy">
            <h2>Name</h2>
            <p>
              Selected as{" "}
              <code>
                {AUTO}/{draft.name.trim() || "name"}
              </code>{" "}
              in model pickers and by Gateway callers.
            </p>
          </div>
          <div data-slot="auto-section-body">
            <Field>
              <Field.Label>Auto model name</Field.Label>
              <TextInput
                appearance="full-width"
                aria-label="Auto model name"
                placeholder="general"
                value={draft.name}
                disabled={pending()}
                onInput={(event) => setDraft("name", event.currentTarget.value)}
              />
              <Show when={!creating() && draft.name.trim() !== props.name}>
                <small data-slot="auto-note">Renaming breaks anything that selects the old name.</small>
              </Show>
            </Field>
          </div>
        </section>

        <section data-slot="auto-section" aria-label="Tiers">
          <div data-slot="auto-section-copy">
            <h2>Tiers</h2>
            <p>
              List tiers from cheapest to most capable and describe when each fits. The judge picks the first tier that
              fits.
            </p>
          </div>
          <div data-slot="auto-section-body">
            <ol data-slot="auto-tiers">
              <Index each={draft.tiers}>
                {(tier, index) => (
                  <li data-slot="auto-tier" role="group" aria-label={`Tier ${index + 1}`}>
                    <span data-slot="auto-tier-index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div data-slot="auto-tier-fields">
                      <Field>
                        <Field.Label>Name</Field.Label>
                        <TextInput
                          appearance="full-width"
                          aria-label={`Tier ${index + 1} name`}
                          value={tier().name}
                          disabled={pending()}
                          onInput={(event) => setDraft("tiers", index, "name", event.currentTarget.value)}
                        />
                      </Field>
                      <Field>
                        <Field.Label>Model</Field.Label>
                        <ModelPicker
                          label={`Tier ${index + 1} model`}
                          options={() => catalog.withCurrent(draft.tiers[index]?.key ?? "")}
                          current={() => draft.tiers[index]?.key ?? ""}
                          pending={pending}
                          select={(pick) => setDraft("tiers", index, "key", pick.key)}
                        />
                      </Field>
                      <Field data-slot="auto-tier-description">
                        <Field.Label>Use when</Field.Label>
                        <Textarea
                          appearance="full-width"
                          aria-label={`Tier ${index + 1} description`}
                          rows={2}
                          placeholder={
                            index === 0
                              ? "Short factual questions and small edits"
                              : "Multi-step work that needs careful reasoning"
                          }
                          value={tier().description}
                          disabled={pending()}
                          onInput={(event) => setDraft("tiers", index, "description", event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <div data-slot="auto-tier-actions">
                      <IconButton
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        icon={<Icon name="arrow-up" size="small" />}
                        aria-label={`Move tier ${index + 1} up`}
                        disabled={pending() || index === 0}
                        onClick={() => move(index, index - 1)}
                      />
                      <IconButton
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        data-slot="auto-tier-down"
                        icon={<Icon name="arrow-up" size="small" />}
                        aria-label={`Move tier ${index + 1} down`}
                        disabled={pending() || index === draft.tiers.length - 1}
                        onClick={() => move(index, index + 1)}
                      />
                      <IconButton
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        icon={<Icon name="close" size="small" />}
                        aria-label={`Remove tier ${index + 1}`}
                        disabled={pending() || draft.tiers.length === 1}
                        onClick={() =>
                          setDraft("tiers", (current) => current.filter((_, position) => position !== index))
                        }
                      />
                    </div>
                  </li>
                )}
              </Index>
            </ol>
            <div data-slot="auto-row">
              <Button
                type="button"
                variant="outline"
                size="small"
                icon="central-plus-small"
                disabled={pending()}
                onClick={() =>
                  setDraft("tiers", (current) => [
                    ...current,
                    { name: `tier-${current.length + 1}`, key: "", description: "" },
                  ])
                }
              >
                Add tier
              </Button>
            </div>
            <Field>
              <Field.Label>Default tier</Field.Label>
              <Select
                aria-label="Default tier"
                data-policy-select=""
                options={tierNames()}
                current={draft.defaultTier}
                appearance="full-width"
                disabled={pending()}
                onSelect={(name) => name && setDraft("defaultTier", name)}
              />
              <small data-slot="auto-note">
                Used when the judge fails, times out, or picks a tier that cannot serve the request.
              </small>
            </Field>
          </div>
        </section>

        <section data-slot="auto-section" aria-label="Judge">
          <div data-slot="auto-section-copy">
            <h2>Judge</h2>
            <p>
              An inexpensive, fast model that reads only participant messages and is charged like any other inference.
            </p>
          </div>
          <div data-slot="auto-section-body">
            <Field>
              <Field.Label>Judge model</Field.Label>
              <ModelPicker
                label="Judge model"
                options={() => catalog.withCurrent(draft.judgeKey)}
                current={() => draft.judgeKey}
                pending={pending}
                select={(pick) => setDraft("judgeKey", pick.key)}
              />
            </Field>
            <Collapsible variant="ghost" data-slot="auto-advanced">
              <Collapsible.Trigger>
                Advanced settings <Collapsible.Arrow />
              </Collapsible.Trigger>
              <Collapsible.Content>
                <div data-slot="auto-advanced-fields">
                  <Field>
                    <Field.Label>Additional instructions</Field.Label>
                    <Textarea
                      appearance="full-width"
                      aria-label="Additional judge instructions"
                      rows={3}
                      value={draft.instructions}
                      disabled={pending()}
                      onInput={(event) => setDraft("instructions", event.currentTarget.value)}
                    />
                  </Field>
                  <div data-slot="route-pair">
                    <Field>
                      <Field.Label>Timeout (ms)</Field.Label>
                      <TextInput
                        appearance="full-width"
                        numeric
                        inputmode="numeric"
                        aria-label="Judge timeout"
                        placeholder="3000"
                        value={draft.timeout}
                        disabled={pending()}
                        onInput={(event) => setDraft("timeout", event.currentTarget.value)}
                      />
                    </Field>
                    <Field>
                      <Field.Label>Earlier messages shown</Field.Label>
                      <TextInput
                        appearance="full-width"
                        numeric
                        inputmode="numeric"
                        aria-label="Earlier messages shown to the judge"
                        placeholder="3"
                        value={draft.window}
                        disabled={pending()}
                        onInput={(event) => setDraft("window", event.currentTarget.value)}
                      />
                    </Field>
                  </div>
                </div>
              </Collapsible.Content>
            </Collapsible>
          </div>
        </section>

        <Show when={props.route !== undefined}>
          <section data-slot="auto-section" aria-label="Test routing">
            <div data-slot="auto-section-copy">
              <h2>Test routing</h2>
              <p>
                <Show
                  when={!creating() && !dirty()}
                  fallback={creating() ? "Create the Auto model to test it." : "Save your changes to test them."}
                >
                  Route a sample message. The judge runs for real and is charged to you; the chosen model is not called.
                </Show>
              </p>
            </div>
            <div data-slot="auto-section-body">
              <Field>
                <Field.Label>Sample message</Field.Label>
                <Textarea
                  appearance="full-width"
                  aria-label="Sample message"
                  rows={3}
                  placeholder="Summarise this contract and flag unusual clauses"
                  value={status.trialPrompt}
                  disabled={status.trialPending || creating() || dirty()}
                  onInput={(event) => setStatus("trialPrompt", event.currentTarget.value)}
                />
              </Field>
              <div data-slot="route-trial-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={status.trialPending || creating() || dirty() || status.trialPrompt.trim() === ""}
                  onClick={() => void runTrial()}
                >
                  {status.trialPending ? "Testing…" : "Test"}
                </Button>
                <Show when={status.trialResult}>
                  {(result) => (
                    <p role="status" data-slot="route-trial-result">
                      → {modelName(result().model)}
                      <Show when={result().route.tier}>{(tier) => <> · tier {tier()}</>}</Show> (
                      {CAUSE_LABELS[result().route.cause] ?? result().route.cause}
                      <Show when={result().route.fallback}>{(reason) => <>: {reason()}</>}</Show>)
                    </p>
                  )}
                </Show>
                <Show when={status.trialError}>{(message) => <p role="alert">{message()}</p>}</Show>
              </div>
            </div>
          </section>
        </Show>
      </div>
    </WorkspacePage>
  )
}

/** One-line summary of an Auto model's Tiers for the routing list. */
export function tierSummary(
  model: AutoModel,
  name: (ref: { readonly provider: string; readonly id: string }) => string,
) {
  return model.rule.to.tiers.map((tier) => `${tier.name}: ${name(tier.model)}`).join(" · ")
}
