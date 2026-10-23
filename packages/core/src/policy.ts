/** Workspace-local declarative policy transformation and evaluation. */
export * as Policy from "./policy.js"

import type { Model } from "@bymorning/schema/model"
import { ManagedSource } from "@bymorning/schema/policy"
import type { Info, Policy as PolicyDefinition, Rule, RuleType } from "@bymorning/schema/policy"
import { Provider } from "@bymorning/schema/provider"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { PolicyEvaluation } from "./policy/evaluation.js"
import { State } from "./state.js"

export type { Evaluation } from "./policy/evaluation.js"

export interface Editor {
  readonly list: () => ReadonlyArray<Info>
  readonly add: (policy: Omit<Info, "managed" | "suppressed">) => void
  /** Suppresses an ID regardless of transform order. Unknown IDs are a no-op. */
  readonly remove: (id: string) => void
}

/** One enabled rule of a kind with its provenance. `rule` is the zero-based index within the policy. */
export interface Selected<K extends RuleType> {
  readonly policyID: string
  readonly rule: number
  readonly definition: Extract<Rule, { readonly type: K }>
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: Effect.Effect<ReadonlyArray<Info>>
  readonly evaluate: (action: string, resource: string) => Effect.Effect<PolicyEvaluation.Evaluation>
  readonly select: <K extends RuleType>(type: K) => Effect.Effect<ReadonlyArray<Selected<K>>>
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Policy") {}

interface Registry {
  readonly policies: Map<string, Omit<Info, "managed" | "suppressed">>
  readonly removed: Set<string>
}

const layerWith = (coordinator?: State.Coordinator) =>
  Layer.sync(Service, () => {
    const stateCoordinator = coordinator ?? State.makeCoordinator()
    const state = State.create<Registry, Editor>({
      name: "policy",
      coordinator: stateCoordinator,
      initial: () => ({ policies: new Map(), removed: new Set() }),
      editor: (registry) => ({
        list: () => listed(registry),
        add: (policy) => {
          if (registry.policies.has(policy.id)) throw new Error(`Duplicate policy ID: ${policy.id}`)
          registry.policies.set(policy.id, policy)
        },
        remove: (id) => {
          registry.removed.add(id)
        },
      }),
    })
    const policies = () => active(state.get())
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: Effect.sync(() => Object.freeze(listed(state.get()))),
      evaluate: Effect.fn("Policy.evaluate")((action, resource) =>
        Effect.sync(() => PolicyEvaluation.evaluate(action, resource, policies())),
      ),
      select: Effect.fn("Policy.select")((type) => Effect.sync(() => select(policies(), type))),
    })
  })

const listed = (registry: Registry) =>
  Array.from(registry.policies.values(), (policy) =>
    freezeInfo({
      ...policy,
      managed: policy.source.pluginID === ManagedSource.pluginID,
      suppressed: registry.removed.has(policy.id),
    }),
  )

const active = (registry: Registry) => listed(registry).filter((policy) => !policy.suppressed)

/** Enabled rules of one kind in transform order. */
export const select = <K extends RuleType>(
  policies: ReadonlyArray<PolicyDefinition>,
  type: K,
): ReadonlyArray<Selected<K>> =>
  Object.freeze(
    policies.flatMap((policy) =>
      policy.enabled
        ? policy.rules.flatMap((rule, index) =>
            rule.type === type
              ? [
                  Object.freeze({
                    policyID: policy.id,
                    rule: index,
                    definition: rule as Extract<Rule, { readonly type: K }>,
                  }),
                ]
              : [],
          )
        : [],
    ),
  )

const freezeInfo = (info: Info): Info => {
  const rules = Object.freeze(info.rules.map((rule) => Object.freeze({ ...rule })))
  return Object.freeze({
    ...info,
    rules,
    source: Object.freeze({ ...info.source, pluginSource: Object.freeze({ ...info.source.pluginSource }) }),
  })
}

const normalizedVariant = (variant?: string) => (variant === undefined || variant === "default" ? undefined : variant)

export const Resource = {
  model: (model: Model.Ref) =>
    `${model.provider}/${model.id}${normalizedVariant(model.variant) === undefined ? "" : `#${model.variant}`}`,
  parseModel: (resource: string): Model.Ref | undefined => {
    const slash = resource.indexOf("/")
    if (slash <= 0 || slash === resource.length - 1) return undefined
    const provider = resource.slice(0, slash)
    const model = resource.slice(slash + 1)
    const hash = model.indexOf("#")
    const id = hash === -1 ? model : model.slice(0, hash)
    const variant = hash === -1 ? undefined : normalizedVariant(model.slice(hash + 1))
    if (id.length === 0 || (hash !== -1 && model.slice(hash + 1).length === 0)) return undefined
    const decodedProvider = Schema.decodeUnknownOption(Provider.Name)(provider)
    if (Option.isNone(decodedProvider)) return undefined
    return { provider: decodedProvider.value, id, ...(variant === undefined ? {} : { variant }) }
  },
  providerRequest: (model: Pick<Model.Ref, "id" | "variant">) =>
    `${model.id}${normalizedVariant(model.variant) === undefined ? "" : `#${model.variant}`}`,
  provider: (provider: Provider.Name) => provider,
  tool: (tool: string) => tool,
  modelTool: (model: Model.Ref, tool: string) => `${Resource.model(model)}::${tool}`,
  toolPair: (left: string, right: string) => [left, right].sort().join("::"),
} as const

export const Action = {
  modelRequest: "model.request",
  providerRequest: "provider.request",
} as const

/** Rule kinds with a runtime enforcement point. Tool input/output and escalation were never wired to an enforcement point; they are rejected at authoring and reported as unwired by the Plugin migration report, never silently admitted. */
export const Enforced = new Set<RuleType>([
  "guardrail",
  "route",
  "endpoint",
  "instruction",
  "prompt",
])

/** Compatibility Policy layer with an isolated coordinator for direct callers. */
export const layer = layerWith()

/** Canonical workspace-local policy registry. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(State.Service, (coordinator) => layerWith(coordinator))),
  deps: [State.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = () => makeWorkspaceNode({ service: Service, layer, deps: [] })
