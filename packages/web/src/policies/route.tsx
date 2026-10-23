import type * as Workspace from "@bymorning/schema/workspace"
import { makeEventListener } from "@solid-primitives/event-listener"
import { For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { WorkspacePage } from "../home/workspace-page"
import { ActionMenu } from "../ui/components/action-menu"
import { Button } from "../ui/components/button"
import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { Empty } from "../ui/components/empty"
import { Icon } from "../ui/components/icon"
import { showToast } from "../ui/components/toast"
import { AUTO, autoModels, autoNames, isAutoModel, isConfigOnly, label } from "./auto"
import { autoModelHref, tierSummary } from "./auto-page"
import { RuleDialog, type RoutePriority, type RoutingRule } from "./rule-dialog"
import type { CatalogModel } from "./model-picker"
import { createRoutingStore, type ConfigClient } from "./store"
import { ambiguousConflicts, conflictCount, conflictIdentity, conflicts, insertRoute, isStrictRefinement, sameRule } from "./routing"
import "./route.css"


const PURPOSE_LABELS: Record<string, string> = {
  assistant: "conversation turns",
  title: "titles",
  compaction: "compaction",
  generate: "one-shot generation",
}

function formatRef(ref: { readonly provider: string; readonly id: string; readonly variant?: string }) {
  const base = `${ref.provider}/${ref.id}`
  return ref.variant === undefined || ref.variant === "default" ? base : `${base}#${ref.variant}`
}

/** A Tool registered in the Workspace, whether built in or contributed by an MCP server. */
export interface RegisteredTool {
  readonly action: string
  readonly name: string
}

/** Workspace-admin Config.routing authoring behind Console → Routing. */
export function PoliciesRoute(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  const [registry, setRegistry] = createStore<{ tools?: ReadonlyArray<RegisteredTool> }>({})
  onMount(() => {
    void data.workspace.model.sync().catch(() => undefined)
    void data.workspace.mcpTool.sync().catch(() => undefined)
    // Every registered Tool, built-in ones included, so a route on one is not shown as unavailable.
    const scope = workspace.current().id
    void sdk.client.permission.tools
      .list({ workspace: scope })
      .then((tools) => {
        if (workspace.current().id === scope) setRegistry("tools", tools)
      })
      .catch(() => undefined)
  })
  return <PoliciesPage
    workspaceID={workspace.current().id}
    client={sdk.client["api.config"]}
    models={() => data.workspace.model.rows().map((row) => row.info)}
    tools={{
      list: data.workspace.mcpTool.list,
      state: data.workspace.mcpTool.state,
      retry: () => void data.workspace.mcpTool.sync().catch(() => undefined),
    }}
    registered={() => registry.tools}
  />
}

/** Console Model routing page for Config.routing remaps. */
export function PoliciesPage(props: {
  readonly workspaceID: Workspace.ID
  readonly client: ConfigClient
  readonly models: () => ReadonlyArray<CatalogModel>
  readonly tools: Parameters<typeof RuleDialog>[0]["tools"]
  /** Every registered Tool; names routes on Tools outside the MCP catalog, such as built-in ones. */
  readonly registered?: () => ReadonlyArray<RegisteredTool> | undefined
}): JSX.Element {
  const dialog = useDialog()
  const routing = createRoutingStore({ client: props.client, workspaceID: props.workspaceID })
  const state = routing.state
  let disposed = false
  let addButton: HTMLButtonElement | undefined
  let lastMenuTrigger: HTMLButtonElement | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let dialogFocusTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    disposed = true
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    if (dialogFocusTimer !== undefined) clearTimeout(dialogFocusTimer)
  })

  const cancelFocus = () => {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    focusTimer = undefined
  }
  const scheduleFocus = (preferred: HTMLButtonElement | undefined, delay: number) => {
    cancelFocus()
    focusTimer = setTimeout(() => {
      focusTimer = undefined
      // The dialog that scheduled this may still be on the stack, closing: when
      // both timers are overdue the browser can run this one before the dialog
      // stack's own removal timer. Only a dialog that is still open owns focus.
      if (disposed || (dialog.active !== undefined && !dialog.active.closing)) return
      // A menu or dialog opened since the schedule owns focus now; stealing it dismisses the layer.
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest('[data-slot="action-menu-content"], [role="menu"], [data-component="dialog"]')) return
      if (document.querySelector('[data-slot="action-menu-content"][data-expanded]') !== null) return
      ;(preferred?.isConnected ? preferred : addButton)?.focus({ preventScroll: true })
    }, delay)
  }
  const ensureDialogFocus = (label: string) => {
    if (dialogFocusTimer !== undefined) clearTimeout(dialogFocusTimer)
    dialogFocusTimer = setTimeout(() => {
      dialogFocusTimer = undefined
      const activeDialog = document.querySelector<HTMLElement>(`[data-component="dialog"][aria-label="${label}"]`)
      if (disposed || activeDialog === null || activeDialog.contains(document.activeElement)) return
      activeDialog.querySelector<HTMLElement>('[data-slot="dialog-close-button"]')?.focus({ preventScroll: true })
    })
  }
  makeEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape") return
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !active.closest('[data-slot="action-menu-content"]')) return
    scheduleFocus(lastMenuTrigger, 0)
  })
  // A pending dialog-close focus restore is stale once an action menu takes focus.
  makeEventListener(window, "focusin", (event) => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('[data-slot="policy-action-menu"], [data-slot="action-menu-content"]')) cancelFocus()
  })

  const rules = routing.rules
  const routingIdentity = (routing: ReadonlyArray<RoutingRule>) => JSON.stringify(routing)
  const locateRule = (current: ReadonlyArray<RoutingRule>, rule: RoutingRule, index: number, openingIdentity: string) => {
    const selected = current[index]
    if (routingIdentity(current) === openingIdentity) return selected !== undefined && sameRule(selected, rule) ? index : -1
    const matches = current.flatMap((candidate, currentIndex) => sameRule(candidate, rule) ? [currentIndex] : [])
    return matches.length === 1 ? matches[0]! : -1
  }
  const withoutRule = (current: ReadonlyArray<RoutingRule>, rule: RoutingRule, index: number, openingIdentity: string) => {
    const originalIndex = locateRule(current, rule, index, openingIdentity)
    return originalIndex < 0 ? [...current] : current.filter((_, currentIndex) => currentIndex !== originalIndex)
  }
  const modelName = (ref: { readonly provider: string; readonly id: string; readonly variant?: string }) => {
    if (ref.provider === AUTO) return label(ref.id)
    const matches = props.models().filter((model) => model.provider === ref.provider && model.id === ref.id)
    const model = matches[0]
    if (model === undefined) return `${ref.id} (${formatRef(ref)})`
    const duplicate = props.models().filter((item) => item.name === model.name).length > 1
    const name = ref.variant && ref.variant !== "default" ? `${model.name} · ${ref.variant}` : model.name
    return duplicate ? `${name} (${formatRef(ref)})` : name
  }
  const toolName = (action: string) => {
    const catalog = props.tools.list() ?? []
    const tool = catalog.find((item) => item.action === action)
    if (tool === undefined) {
      const registered = props.registered?.()?.find((item) => item.action === action)
      return registered === undefined ? `${action} (unavailable)` : registered.name
    }
    return catalog.filter((item) => item.name === tool.name).length > 1 ? `${tool.name} (${tool.server}/${tool.action})` : tool.name
  }
  const describe = (rule: RoutingRule) => {
    const parts = describeParts(rule)
    return `${parts.phrase} → ${parts.destination}`
  }
  const describeParts = (rule: RoutingRule) => {
    const match = rule.match
    const conditions = [
      match.model === undefined ? undefined : modelName(match.model),
      match.purpose === undefined ? undefined : `for ${match.purpose.map((purpose) => PURPOSE_LABELS[purpose] ?? purpose).join(", ")}`,
      match.text === undefined ? undefined : `message matches /${match.text.pattern}/${match.text.flags ?? ""}`,
      match.context === undefined
        ? undefined
        : [match.context.min === undefined ? "" : `≥ ${match.context.min}`, match.context.max === undefined ? "" : `≤ ${match.context.max}`]
            .filter(Boolean)
            .join(" and ") + " tokens",
      match.images === undefined ? undefined : match.images ? "with images" : "without images",
      match.agent === undefined ? undefined : `Agent ${match.agent}`,
      match.tool === undefined ? undefined : `${toolName(match.tool)} completed`,
    ].filter((condition): condition is string => condition !== undefined)
    // A completed Tool alone reads as "After <tool>", matching the original remap wording.
    const phrase = conditions.length === 1 && match.tool !== undefined ? `After ${toolName(match.tool)}` : conditions.join(" + ")
    const to = rule.to
    const destination = "tiers" in to
      ? `${to.tiers.map((tier) => `${tier.name} (${modelName(tier.model)})`).join(" · ")}, judged by ${modelName(to.judge.model)}`
      : modelName(to)
    return { phrase, destination }
  }
  const refresh = routing.refresh
  const persist = routing.persist
  onMount(() => void refresh())
  const autoEntries = () => autoModels(rules())
  const ruleEntries = () => rules().flatMap((rule, index) => (isAutoModel(rule) ? [] : [{ rule, index }]))

  const openCreate = () => {
    if (state.pending) return
    dialog.show(() => <RuleDialog
      models={props.models}
      autoNames={() => autoNames(rules())}
      tools={props.tools}
      existing={rules()}
      describe={describe}
      submit={async (rule, priority, reviewedConflicts) => {
        await persist((current) => {
          if (current.some((existing) => sameRule(rule, existing))) throw new Error("This route already exists. Edit the existing route instead.")
          if (priority !== undefined && conflictIdentity(rule, current) !== reviewedConflicts) {
            throw new Error("Routing changed. Review the conflict and try again.")
          }
          if (ambiguousConflicts(rule, current).length > 0 && priority === undefined) {
            throw new Error("Routing changed. Review the conflict and try again.")
          }
          return insertRoute(current, rule, priority)
        })
        showToast({ variant: "success", title: "Route added" })
      }}
    />, () => scheduleFocus(addButton, 110))
    ensureDialogFocus("Add route")
  }

  const openEdit = (index: number, trigger?: HTMLButtonElement) => {
    if (state.pending) return
    const rule = rules()[index]
    if (rule === undefined) return
    const openingIdentity = routingIdentity(rules())
    dialog.show(() => <RuleDialog
      rule={rule}
      models={props.models}
      autoNames={() => autoNames(rules())}
      tools={props.tools}
      existing={withoutRule(rules(), rule, index, openingIdentity)}
      describe={describe}
      submit={async (next, priority: RoutePriority | undefined, reviewedConflicts) => {
        await persist((current) => {
          const originalIndex = locateRule(current, rule, index, openingIdentity)
          if (originalIndex < 0) {
            throw new Error("Routing changed. Reopen the route and try again.")
          }
          const remaining = current.filter((_, currentIndex) => currentIndex !== originalIndex)
          if (!sameRule(next, rule) && remaining.some((existing) => sameRule(next, existing))) throw new Error("This route already exists. Edit the existing route instead.")
          if (priority !== undefined && conflictIdentity(next, remaining) !== reviewedConflicts) {
            throw new Error("Routing changed. Review the conflict and try again.")
          }
          if (ambiguousConflicts(next, remaining).length > 0 && priority === undefined) {
            throw new Error("Routing changed. Review the conflict and try again.")
          }
          return insertRoute(remaining, next, priority, Math.min(originalIndex, remaining.length))
        })
        showToast({ variant: "success", title: "Route saved" })
      }}
    />, () => scheduleFocus(trigger, 110))
    ensureDialogFocus("Edit route")
  }

  const openRemove = (index: number, trigger?: HTMLButtonElement) => {
    if (state.pending) return
    const rule = rules()[index]
    if (rule === undefined) return
    const openingIdentity = routingIdentity(rules())
    dialog.show(() => <ConfirmDialog
      title="Remove route?"
      description={describe(rule)}
      confirmLabel="Remove"
      danger
      onConfirm={async () => {
        await persist((current) => {
          const currentIndex = locateRule(current, rule, index, openingIdentity)
          if (currentIndex < 0) throw new Error("Routing changed. Reopen the route and try again.")
          return current.filter((_, position) => position !== currentIndex)
        })
        showToast({ variant: "success", title: "Route removed" })
      }}
    />, () => scheduleFocus(trigger, 110))
    ensureDialogFocus("Remove route?")
  }

  const reviewConflicts = (trigger: HTMLButtonElement) => {
    const current = rules()
    const involved = (index: number) => {
      const rule = current[index]!
      return ambiguousConflicts(rule, current.filter((_, position) => position !== index)).length > 0 ||
        current.some((other, position) => position < index ? conflicts(rule, other) && isStrictRefinement(rule, other) : position > index && conflicts(other, rule) && isStrictRefinement(other, rule))
    }
    // Auto models are edited on their own page; review opens the first conflicting rule.
    const found = ruleEntries().find((entry) => !isConfigOnly(entry.rule) && involved(entry.index))
    if (found !== undefined) openEdit(found.index, trigger)
  }

  return <WorkspacePage
    layout="table"
    title="Model routing"
    description="Choose which model each request uses, or let a judge pick the cheapest suitable model."
  >
    <div data-component="policies-region">
      <Switch>
        <Match when={state.phase === "loading"}><p role="status" aria-label="Loading routes" data-slot="policies-status">Loading routes…</p></Match>
        <Match when={state.phase === "error"}><div data-slot="policies-error"><p role="alert">{state.loadError ?? "Could not load routes."}</p><Button type="button" variant="ghost" disabled={state.pending} onClick={() => void refresh()}>Try again</Button></div></Match>
        <Match when={state.phase === "ready"}>
          <section data-slot="policies-section" aria-label="Auto models">
            <div data-slot="policies-section-heading">
              <div data-slot="policies-section-copy">
                <h2>Auto models</h2>
                <p>Selectable models that send each request to the cheapest tier a judge model thinks fits.</p>
              </div>
              <Button as="a" href={autoModelHref(props.workspaceID)} variant="outline" icon="central-plus-small" aria-disabled={state.pending || props.models().length === 0}>New Auto model</Button>
            </div>
            <Show when={autoEntries().length > 0} fallback={<Empty variant="panel" label="No Auto models">No Auto models yet. Create one to let a judge pick between cheaper and more capable models.</Empty>}>
              <ul data-slot="route-list" aria-label="Auto models">
                <For each={autoEntries()}>{(entry) =>
                  <li>
                    <a data-slot="auto-link" href={autoModelHref(props.workspaceID, entry.name)}>
                      <span data-slot="route-copy">
                        <strong data-slot="auto-name">{AUTO}/{entry.name}</strong>
                        <span data-slot="route-meta">{tierSummary(entry, modelName)} · judged by {modelName(entry.rule.to.judge.model)}</span>
                      </span>
                      <Icon name="chevron-right" size="small" />
                    </a>
                  </li>
                }</For>
              </ul>
            </Show>
          </section>

          <section data-slot="policies-section" aria-label="Rules">
            <div data-slot="policies-section-heading">
              <div data-slot="policies-section-copy">
                <h2>Rules</h2>
                <p>Send matching requests to one model. When several rules match, the one listed last applies.</p>
              </div>
              <Button ref={addButton} variant="outline" icon="central-plus-small" disabled={state.phase !== "ready" || state.pending || props.models().length === 0} onClick={openCreate}>Add route</Button>
            </div>
            <Show when={conflictCount(rules())}>{(count) => <button type="button" data-slot="routing-conflicts" onClick={(event) => reviewConflicts(event.currentTarget)}>{count()} routing {count() === 1 ? "conflict needs" : "conflicts need"} review</button>}</Show>
            <Show when={ruleEntries().length > 0} fallback={<Empty variant="panel" label="No routes">No routes yet. Add one to send matching requests to a different model.</Empty>}>
              <ul data-slot="route-list" aria-label="Routes">
                <For each={ruleEntries()}>{(entry, position) => {
                  let menuHost: HTMLDivElement | undefined
                  const menuTrigger = () => menuHost?.querySelector<HTMLButtonElement>('[data-slot="action-menu-trigger"]') ?? undefined
                  const parts = () => describeParts(entry.rule)
                  return <li>
                    <span data-slot="route-copy">
                      <span data-slot="route-statement">
                        <span data-slot="route-when">{parts().phrase}</span>
                        <span data-slot="route-arrow">{" → "}</span>
                        <strong data-slot="route-to">{parts().destination}</strong>
                      </span>
                      <Show when={isConfigOnly(entry.rule)}><span data-slot="route-meta"> Edit this tiered rule in Workspace configuration.</span></Show>
                    </span>
                    <div ref={menuHost} data-slot="policy-action-menu" onFocusIn={() => { lastMenuTrigger = menuTrigger() }}>
                      <ActionMenu label={`routing rule ${position() + 1}`} disabled={state.pending}>
                        <Show when={!isConfigOnly(entry.rule)}>
                          <ActionMenu.Item onSelect={() => openEdit(entry.index, menuTrigger())}>Edit</ActionMenu.Item>
                        </Show>
                        <ActionMenu.Item class="danger" onSelect={() => openRemove(entry.index, menuTrigger())}>Remove</ActionMenu.Item>
                      </ActionMenu>
                    </div>
                  </li>
                }}</For>
              </ul>
            </Show>
          </section>
        </Match>
      </Switch>
    </div>
  </WorkspacePage>
}
