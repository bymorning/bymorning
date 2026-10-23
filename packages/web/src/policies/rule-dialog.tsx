import type { McpToolsListOutput } from "@bymorning/client"
import { Config } from "@bymorning/schema/config"
import { Option, Schema } from "effect"
import { createEffect, createMemo, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { DataState } from "../context/data"
import { ToolPicker } from "../mcp/tool-picker"
import { Button } from "../ui/components/button"
import { Checkbox } from "../ui/components/checkbox"
import { IconButton } from "../ui/components/icon-button"
import { Icon } from "../ui/components/icon"
import { RadioGroup, RadioItem } from "../ui/components/radio"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"
import { createForm, FormDialog, FormFrame } from "../ui/form"
import { AUTO, label } from "./auto"
import {
  createModelPicks,
  ModelPicker,
  modelValue,
  normalizedVariant,
  selectedVariant,
  variantLabel,
  variantOptions,
  type CatalogModel,
} from "./model-picker"
import { ambiguousConflicts, conflictIdentity, sameRule } from "./routing"

export type RoutingRule = NonNullable<Config.Info["routing"]>[number]
export type RoutePriority = "this" | "existing"
type Purpose = "assistant" | "title" | "compaction" | "generate"

const PURPOSES: ReadonlyArray<{ readonly value: Purpose; readonly label: string }> = [
  { value: "assistant", label: "Chat turns" },
  { value: "title", label: "Titles" },
  { value: "compaction", label: "Compaction" },
  { value: "generate", label: "One-shot" },
]

/** Conditions in display order, each shown only once the administrator adds it. */
const CONDITIONS = [
  { key: "model", label: "Requested model" },
  { key: "purpose", label: "Request type" },
  { key: "text", label: "Message matches" },
  { key: "context", label: "Context size" },
  { key: "images", label: "Images" },
  { key: "agent", label: "Agent" },
  { key: "tool", label: "After tool" },
] as const
type ConditionKey = (typeof CONDITIONS)[number]["key"]
const labelOf = (key: ConditionKey) => CONDITIONS.find((condition) => condition.key === key)!.label

interface ToolCatalog {
  readonly list: () => McpToolsListOutput | undefined
  readonly state: () => DataState
  readonly retry: () => void
}

interface Draft {
  readonly shown: ReadonlyArray<ConditionKey>
  readonly fromKey: string
  readonly fromVariant: string
  readonly purposes: ReadonlyArray<Purpose>
  readonly pattern: string
  readonly ignoreCase: boolean
  readonly contextMin: string
  readonly contextMax: string
  readonly images: "yes" | "no"
  readonly agent: string
  readonly tool: string
  readonly toKey: string
  readonly toVariant: string
  readonly priority: "" | RoutePriority
}

function decodeRule(input: unknown) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(Config.Routing)(input))
}

const integer = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN
}

const validPattern = (pattern: string, flags: string) => {
  try {
    new RegExp(pattern, flags)
    return true
  } catch {
    return false
  }
}

/** Dialog that authors one routing rule: the conditions it matches and the one Model it uses. */
export function RuleDialog(props: {
  readonly rule?: RoutingRule
  readonly existing?: ReadonlyArray<RoutingRule>
  readonly models: () => ReadonlyArray<CatalogModel>
  /** Auto names a rule may match. */
  readonly autoNames?: () => ReadonlyArray<string>
  readonly tools: ToolCatalog
  readonly describe?: (rule: RoutingRule) => string
  readonly submit: (rule: RoutingRule, priority: RoutePriority | undefined, conflicts: string) => Promise<unknown>
}): JSX.Element {
  const [picker, setPicker] = createStore<{ tool: boolean }>({ tool: false })
  const catalog = createModelPicks(props.models)
  // The requested model may also be an Auto name; destinations are always Catalog models.
  const requestable = createModelPicks(() => [
    ...(props.autoNames?.() ?? []).map((name) => ({ provider: AUTO as CatalogModel["provider"], id: name, name: label(name), variants: [] })),
    ...props.models(),
  ])
  const match = props.rule?.match
  const to = props.rule !== undefined && !("tiers" in props.rule.to) ? props.rule.to : undefined
  const toolCache = new Map<string, McpToolsListOutput[number]>()
  if (match?.tool !== undefined)
    toolCache.set(match.tool, { action: match.tool, name: match.tool, server: "Unavailable", description: "This configured tool is unavailable" })
  const initiallyShown = props.rule
    ? CONDITIONS.map((condition) => condition.key).filter((key) => match?.[key] !== undefined)
    : (["model"] as ConditionKey[])

  const form = createForm({
    values: {
      shown: initiallyShown,
      fromKey: requestable.remember(match?.model),
      fromVariant: selectedVariant(match?.model),
      purposes: [...(match?.purpose ?? ["assistant"])] as ReadonlyArray<Purpose>,
      pattern: match?.text?.pattern ?? "",
      ignoreCase: match?.text?.flags?.includes("i") ?? true,
      contextMin: match?.context?.min?.toString() ?? "",
      contextMax: match?.context?.max?.toString() ?? "",
      images: (match?.images === false ? "no" : "yes") as Draft["images"],
      agent: match?.agent ?? "",
      tool: match?.tool ?? "",
      toKey: catalog.remember(to),
      toVariant: selectedVariant(to),
      priority: "" as "" | RoutePriority,
    } satisfies Draft,
    validate: (values) => {
      const problem = incomplete(values)
      if (problem !== undefined) return problem
      const rule = candidate(values)
      if (rule === undefined) return "Check the route's values."
      if ((!props.rule || !sameRule(rule, props.rule)) && (props.existing ?? []).some((existing) => sameRule(rule, existing))) return "This route already exists. Edit the existing route instead."
      if (ambiguousConflicts(rule, props.existing ?? []).length > 0 && values.priority === "") return "Choose which route should take priority."
      return undefined
    },
    submit: (values) => {
      const rule = candidate(values)
      if (rule === undefined) return Promise.reject(new Error(incomplete(values) ?? "Check the route's values."))
      return props.submit(rule, values.priority || undefined, conflictIdentity(rule, props.existing ?? []))
    },
    fallback: props.rule ? "The route could not be saved." : "The route could not be added.",
  })

  const shown = (key: ConditionKey) => form.values.shown.includes(key)
  const available = () => CONDITIONS.filter((condition) => !shown(condition.key))
  const tools = createMemo<McpToolsListOutput>(() => {
    const listed = props.tools.list() ?? []
    for (const tool of listed) toolCache.set(tool.action, tool)
    const current = form.values.tool.trim()
    if (current === "" || listed.some((tool) => tool.action === current)) return [...listed]
    const selected = toolCache.get(current)
    return selected ? [selected, ...listed] : [...listed]
  })
  const fromVariants = createMemo(() => variantOptions(requestable.find(form.values.fromKey)?.variants ?? []))
  const toVariants = createMemo(() => variantOptions(catalog.find(form.values.toKey)?.variants ?? []))

  /** The first missing or invalid value, phrased for the administrator. */
  function incomplete(values: Draft): string | undefined {
    const has = (key: ConditionKey) => values.shown.includes(key)
    if (values.shown.length === 0) return "Add at least one condition."
    if (has("model") && requestable.find(values.fromKey) === undefined) return "Choose the requested model."
    if (has("purpose") && values.purposes.length === 0) return "Choose at least one request type."
    if (has("text") && (values.pattern.trim() === "" || !validPattern(values.pattern, values.ignoreCase ? "i" : "")))
      return "Enter a valid text pattern."
    if (has("context")) {
      const min = integer(values.contextMin)
      const max = integer(values.contextMax)
      if (Number.isNaN(min) || Number.isNaN(max) || (min === undefined && max === undefined)) return "Enter a whole-number token range."
      if (min !== undefined && max !== undefined && min > max) return "The minimum context size exceeds the maximum."
    }
    if (has("agent") && values.agent.trim() === "") return "Enter the Agent."
    if (has("tool") && values.tool.trim() === "") return "Choose the completed tool."
    if (catalog.find(values.toKey) === undefined) return "Choose a destination model."
    return undefined
  }

  function candidate(values: Draft = form.values): RoutingRule | undefined {
    if (incomplete(values) !== undefined) return undefined
    const has = (key: ConditionKey) => values.shown.includes(key)
    const min = integer(values.contextMin)
    const max = integer(values.contextMax)
    const match = {
      ...(has("model") ? { model: modelValue(requestable.find(values.fromKey), normalizedVariant(fromVariants(), values.fromVariant)) } : {}),
      ...(has("purpose") ? { purpose: PURPOSES.map((item) => item.value).filter((value) => values.purposes.includes(value)) } : {}),
      ...(has("text") ? { text: { pattern: values.pattern, ...(values.ignoreCase ? { flags: "i" } : {}) } } : {}),
      ...(has("context") ? { context: { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) } } : {}),
      ...(has("images") ? { images: values.images === "yes" } : {}),
      ...(has("agent") ? { agent: values.agent.trim() } : {}),
      ...(has("tool") ? { tool: values.tool.trim() } : {}),
    }
    return decodeRule({ match, to: modelValue(catalog.find(values.toKey), normalizedVariant(toVariants(), values.toVariant)) })
  }

  const conflicts = createMemo(() => {
    const rule = candidate()
    return rule === undefined ? [] : ambiguousConflicts(rule, props.existing ?? [])
  })
  const candidateKey = createMemo(() => JSON.stringify(candidate()))
  const conflictKey = createMemo(() => {
    const rule = candidate()
    return rule === undefined ? "" : conflictIdentity(rule, props.existing ?? [])
  })
  let previousCandidateKey = candidateKey()
  let previousConflictKey = conflictKey()
  createEffect(() => {
    const next = candidateKey()
    const nextConflicts = conflictKey()
    if (next !== previousCandidateKey || nextConflicts !== previousConflictKey) {
      previousCandidateKey = next
      previousConflictKey = nextConflicts
      form.set("priority", "")
    }
  })
  const toolError = () => {
    const state = props.tools.state()
    return state.state === "error" ? state.message : undefined
  }
  const pending = () => form.pending
  const togglePurpose = (purpose: Purpose, checked: boolean) =>
    form.set("purposes", (current) => checked ? [...new Set([...current, purpose])] : current.filter((item) => item !== purpose))
  const add = (key: ConditionKey) =>
    form.set("shown", (current) => CONDITIONS.map((condition) => condition.key).filter((item) => item === key || current.includes(item)))
  const remove = (key: ConditionKey) => form.set("shown", (current) => current.filter((item) => item !== key))

  const body = (key: ConditionKey): JSX.Element => <Switch>
    <Match when={key === "model"}>
      <ModelPicker label="Model" options={() => requestable.withCurrent(form.values.fromKey)} current={() => form.values.fromKey} pending={pending} select={(pick) => {
        form.set("fromKey", pick.key)
        if (!pick.variants.includes(form.values.fromVariant) && form.values.fromVariant !== "default") form.set("fromVariant", "default")
      }} />
      <Show when={requestable.find(form.values.fromKey) !== undefined && fromVariants().length > 1}>
        <Select aria-label="Variant" data-policy-select="" options={fromVariants()} current={normalizedVariant(fromVariants(), form.values.fromVariant)} label={variantLabel} appearance="full-width" disabled={form.pending} onSelect={(variant) => variant && form.set("fromVariant", variant)} />
      </Show>
    </Match>
    <Match when={key === "purpose"}>
      <div data-slot="route-inline" data-wrap="">
        <For each={PURPOSES}>{(purpose) =>
          <Checkbox label={purpose.label} checked={form.values.purposes.includes(purpose.value)} disabled={form.pending} onChange={(checked) => togglePurpose(purpose.value, checked)} />
        }</For>
      </div>
    </Match>
    <Match when={key === "text"}>
      <TextInput appearance="full-width" aria-label="Regular expression" placeholder="urgent|security review" value={form.values.pattern} disabled={form.pending} onInput={(event) => form.set("pattern", event.currentTarget.value)} />
      <Checkbox label="Ignore case" checked={form.values.ignoreCase} disabled={form.pending} onChange={(checked) => form.set("ignoreCase", checked)} />
    </Match>
    <Match when={key === "context"}>
      <div data-slot="route-inline" data-range="">
        <TextInput numeric inputmode="numeric" aria-label="Minimum tokens" placeholder="0" value={form.values.contextMin} disabled={form.pending} onInput={(event) => form.set("contextMin", event.currentTarget.value)} />
        <span aria-hidden="true">–</span>
        <TextInput numeric inputmode="numeric" aria-label="Maximum tokens" placeholder="∞" value={form.values.contextMax} disabled={form.pending} onInput={(event) => form.set("contextMax", event.currentTarget.value)} />
        <span data-slot="route-unit">tokens</span>
      </div>
    </Match>
    <Match when={key === "images"}>
      <RadioGroup label="Images" hideLabel data-slot="route-radio-row" value={form.values.images} onChange={(value) => form.set("images", value as Draft["images"])}>
        <RadioItem value="yes" label="With" />
        <RadioItem value="no" label="Without" />
      </RadioGroup>
    </Match>
    <Match when={key === "agent"}>
      <TextInput appearance="full-width" aria-label="Agent" placeholder="default" value={form.values.agent} disabled={form.pending} onInput={(event) => form.set("agent", event.currentTarget.value)} />
    </Match>
    <Match when={key === "tool"}>
      <Show when={props.tools.list() !== undefined} fallback={<Show when={toolError()} fallback={<p role="status">Loading tools…</p>}>{(message) => <div role="alert"><span>{message()}</span><Button type="button" size="small" variant="ghost" disabled={form.pending} onClick={props.tools.retry}>Try again</Button></div>}</Show>}>
        <ToolPicker tools={tools} current={() => form.values.tool || undefined} pending={pending} open={picker.tool} onOpenChange={(open) => setPicker("tool", open)} onSelect={(action) => form.set("tool", action)} label="Tool" searchLabel="Search tools" placeholder="Choose a tool" />
        <Show when={tools().length === 0}><p role="status">No tools available.</p></Show>
      </Show>
    </Match>
  </Switch>

  return <FormDialog
    form={form}
    title={props.rule ? "Edit route" : "Add route"}
    onSuccess={(_, entry) => entry.close()}
    actions={<FormFrame.Actions submitLabel={props.rule ? "Save route" : "Add route"} pendingLabel="Saving…" disabled={form.values.shown.length === 0} />}
  >
    <FormFrame.Fields>
      <div data-slot="route-flow">
        <section data-slot="route-block" aria-label="When">
          <h3 data-slot="route-block-title">When</h3>
          <For each={form.values.shown}>{(key) =>
            <div data-slot="route-condition" role="group" aria-label={labelOf(key)}>
              <span data-slot="route-condition-label">{labelOf(key)}</span>
              <div data-slot="route-condition-control">{body(key)}</div>
              <IconButton type="button" size="small" variant="ghost-muted" icon={<Icon name="close" size="small" />} aria-label={`Remove condition: ${labelOf(key)}`} disabled={form.pending} onClick={() => remove(key)} />
            </div>
          }</For>
          <Show when={available().length > 0}>
            <div data-slot="route-add-condition">
              <Select aria-label="Add condition" options={[...available()]} current={undefined} placeholder="+ Add condition" value={(condition) => condition.key} label={(condition) => condition.label} sameWidth={false} disabled={form.pending} onSelect={(condition) => condition && add(condition.key)} />
            </div>
          </Show>
        </section>

        <div data-slot="route-flow-arrow" aria-hidden="true"><Icon name="arrow-up" size="small" /></div>

        <section data-slot="route-block" aria-label="Use">
          <h3 data-slot="route-block-title">Use</h3>
          <div data-slot="route-use">
            <ModelPicker label="Model" options={() => catalog.withCurrent(form.values.toKey)} current={() => form.values.toKey} pending={pending} select={(pick) => {
              form.set("toKey", pick.key)
              if (!pick.variants.includes(form.values.toVariant) && form.values.toVariant !== "default") form.set("toVariant", "default")
            }} />
            <Show when={catalog.find(form.values.toKey) !== undefined && toVariants().length > 1}>
              <Select aria-label="Variant" data-policy-select="" options={toVariants()} current={normalizedVariant(toVariants(), form.values.toVariant)} label={variantLabel} appearance="full-width" disabled={form.pending} onSelect={(variant) => variant && form.set("toVariant", variant)} />
            </Show>
          </div>
        </section>
      </div>

      <Show when={conflicts().length > 0}>
        <section data-slot="route-conflict">
          <p>Conflicts with:</p>
          <ul><For each={conflicts()}>{(rule) => <li>{props.describe?.(rule) ?? "Existing route"}</li>}</For></ul>
          <RadioGroup label="Which should take priority?" value={form.values.priority} onChange={(value) => form.set("priority", value as RoutePriority)}>
            <RadioItem value="this" label="This route" />
            <RadioItem value="existing" label="Existing route" />
          </RadioGroup>
        </section>
      </Show>
    </FormFrame.Fields>
  </FormDialog>
}
