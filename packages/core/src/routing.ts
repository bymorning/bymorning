export * as Routing from "./routing.js"

import type { Message, SystemPart } from "@opencode-ai/ai/schema/messages"
import type { ModelRequestPurpose } from "@bymorning/plugin/session-hooks"
import { Model } from "@bymorning/schema/model"
import { RoutingSchema } from "@bymorning/schema/routing"
import type { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Catalog } from "./catalog.js"
import { Config } from "./config.js"
import { KV } from "./kv.js"
import { Classifier } from "./routing/classifier.js"
import { RoutingDigest } from "./routing/digest.js"
import { Judge } from "./routing/judge.js"
import { Match } from "./routing/match.js"
import { Pin } from "./routing/pin.js"
import { Tier } from "./routing/tier.js"

/** Classification input derived from one request's conversation. */
export type Digest = RoutingDigest.Digest

/** One judge inference, performed and accounted for by the entrypoint. */
export type JudgeRequest = Judge.Request

/** The judge's raw answer and its priced cost when known. */
export type JudgeReply = Judge.Reply

/** An Auto name matched no rule, so it cannot be invoked. */
export class UnresolvedError extends Schema.TaggedError<UnresolvedError>()("Routing.UnresolvedError", {
  model: Model.Ref,
}) {}

/** The matched rule has no Tier that can serve this request. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Routing.UnavailableError", {
  model: Model.Ref,
  rule: Schema.Int,
}) {}

/** Routing rules that cannot be saved. */
export class InvalidError extends Schema.TaggedError<InvalidError>()("Routing.InvalidError", {
  issues: Schema.Array(Schema.Struct({ rule: Schema.Int, message: Schema.String })),
}) {}

export interface ResolveInput {
  readonly requestedModel: Model.Ref
  readonly purpose: Exclude<ModelRequestPurpose, "route">
  readonly agent?: string
  /** Conversation facts; absent requests match no text, context, or image condition and are never judged. */
  readonly digest?: Digest
  /** Tools completed in the Session. Absent outside a Session, so completed-Tool conditions never match. */
  readonly tools?: ReadonlySet<string>
  /** Performs one judge inference, consulted only for assistant purposes. Absent requests use the matched rule's default Tier. */
  readonly judge?: (request: JudgeRequest) => Effect.Effect<JudgeReply, unknown>
  /** Additional entrypoint admission of a Tier Model, such as caller protocol compatibility. */
  readonly admits?: (model: Model.Ref) => Effect.Effect<boolean>
  /**
   * Remember judged Tiers per conversation turn for this Workspace. Requests that continue a Tool loop
   * (`digest.human === false`) reuse the pinned Tier instead of being judged again.
   */
  readonly pin?: { readonly workspaceID: Workspace.ID }
}

/** The outcome of routing one request. */
export interface Decision {
  readonly requestedModel: Model.Ref
  readonly model: Model.Ref
  readonly route: RoutingSchema.Route
  readonly judge?: { readonly model: Model.Ref; readonly cost?: number }
}

export interface Interface {
  /** Choose the Catalog Model one request uses. */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Decision, UnresolvedError | UnavailableError>
  /** Validate rules before they are saved. */
  readonly check: (rules: ReadonlyArray<RoutingSchema.Rule>) => Effect.Effect<void, InvalidError>
  /** Auto names at least one current rule matches. */
  readonly names: Effect.Effect<ReadonlyArray<Model.Ref>>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Routing") {}

/** Derive a classification Digest from canonical provider history. */
export const digest = (messages: ReadonlyArray<Message>, system?: ReadonlyArray<SystemPart>): Digest =>
  RoutingDigest.make(messages, system)

/** Remove complete injected reminder blocks from participant text. */
export const strip = RoutingDigest.strip

/** Reserved Provider key of Auto names. */
export const auto = RoutingSchema.auto

/** Whether a Model reference is an Auto name. */
export const isAuto = RoutingSchema.isAuto

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    // Pinning needs KV; production graphs always supply it, focused graphs may omit it and never pin.
    const kv = yield* Effect.serviceOption(KV.Service)

    const runnable = Effect.fn("Routing.runnable")(function* (
      tiers: RoutingSchema.Tiers,
      digest: Digest | undefined,
      admits: ResolveInput["admits"],
    ) {
      const candidates: RoutingSchema.Tier[] = []
      for (const tier of tiers.tiers) {
        const info = yield* catalog.model.requireAvailable(tier.model).pipe(Effect.option)
        if (Option.isNone(info) || !Tier.fits(info.value, digest)) continue
        if (admits !== undefined && !(yield* admits(tier.model))) continue
        candidates.push(tier)
      }
      return candidates
    })

    const resolve = Effect.fn("Routing.resolve")(function* (input: ResolveInput) {
      const rules = (yield* config.get).routing ?? []
      const facts = {
        requestedModel: input.requestedModel,
        purpose: input.purpose,
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(input.digest === undefined ? {} : { digest: input.digest }),
        ...(input.tools === undefined ? {} : { tools: input.tools }),
      }
      const index = Match.decide(rules, facts)
      if (index < 0) {
        if (isAuto(input.requestedModel)) return yield* new UnresolvedError({ model: input.requestedModel })
        return { requestedModel: input.requestedModel, model: input.requestedModel, route: { cause: "none" } } satisfies Decision
      }
      const target = rules[index]!.to
      if (!RoutingSchema.isTiers(target))
        return { requestedModel: input.requestedModel, model: { ...target }, route: { cause: "rule", rule: index } } satisfies Decision

      const candidates = yield* runnable(target, input.digest, input.admits)
      const names = new Set(candidates.map((tier) => tier.name))
      const byName = (name: string) => candidates.find((tier) => tier.name === name)
      const fallbackTier = Tier.substitute(target.tiers, names, target.default)
      if (fallbackTier === undefined)
        return yield* new UnavailableError({ model: input.requestedModel, rule: index })
      const decided = (tier: RoutingSchema.Tier, route: Omit<RoutingSchema.Route, "rule" | "tier">, judged?: Decision["judge"]): Decision => ({
        requestedModel: input.requestedModel,
        model: { ...tier.model },
        route: { ...route, rule: index, tier: tier.name },
        ...(judged === undefined ? {} : { judge: judged }),
      })

      const pinKey =
        Option.isSome(kv) && input.pin !== undefined && input.digest !== undefined && input.digest.turn.length > 0
          ? yield* Pin.key(
              input.pin.workspaceID,
              JSON.stringify([Match.resource(input.requestedModel), target.tiers.map((tier) => tier.name)]),
              input.digest.turn,
            )
          : undefined
      if (pinKey !== undefined && input.digest?.human === false) {
        const pinned = Option.isSome(kv) ? yield* Pin.get(kv.value, pinKey) : undefined
        // An unreadable pin store is not an unpinned turn: judge again as if pinning were absent.
        if (pinned !== Pin.unreadable) {
          const tier = pinned === undefined ? undefined : byName(pinned)
          return tier === undefined
            ? decided(fallbackTier, { cause: "fallback", fallback: "unpinned" })
            : decided(tier, { cause: "pinned" })
        }
      }
      // Only participant conversation turns are judged, matching production: other purposes, and a
      // rule with exactly one runnable Tier, take the default Tier with no judge inference or Usage.
      if (
        input.judge === undefined ||
        input.digest === undefined ||
        input.digest.ask.length === 0 ||
        input.purpose !== "assistant" ||
        candidates.length === 1
      )
        return decided(fallbackTier, { cause: "rule" })

      const classifier = Classifier.select(target)
      const outcome = yield* classifier
        .classify({
          tiers: target,
          candidates,
          digest: input.digest,
          judge: input.judge,
        })
        .pipe(Effect.annotateLogs({ rule: index }))
      const judged = { model: { ...target.judge.model }, ...(outcome.cost === undefined ? {} : { cost: outcome.cost }) }
      const chosen = outcome.type === "chosen" ? byName(outcome.tier) : undefined
      const decision =
        chosen !== undefined
          ? decided(chosen, { cause: "judge" }, judged)
          : decided(
              fallbackTier,
              { cause: "fallback", fallback: outcome.type === "declined" ? outcome.reason : "unavailable" },
              judged,
            )
      if (pinKey !== undefined && Option.isSome(kv) && input.pin !== undefined)
        yield* Pin.set(kv.value, input.pin.workspaceID, pinKey, decision.route.tier!)
      yield* Effect.logDebug("Routing decision").pipe(
        Effect.annotateLogs({
          cause: decision.route.cause,
          rule: index,
          tier: decision.route.tier,
          classifier: `${classifier.kind}@${classifier.version}`,
          model: Match.resource(decision.model),
        }),
      )
      return decision
    })

    const check = Effect.fn("Routing.check")(function* (rules: ReadonlyArray<RoutingSchema.Rule>) {
      const issues: Array<{ rule: number; message: string }> = []
      const known = Effect.fn("Routing.check.known")(function* (rule: number, model: Model.Ref, role: string) {
        if (isAuto(model)) return issues.push({ rule, message: `${role} cannot be an Auto name` })
        const info = yield* catalog.model.get(model.provider, model.id)
        if (info === undefined) issues.push({ rule, message: `${role} ${Match.resource(model)} is not in the Catalog` })
        else if (model.variant !== undefined && model.variant !== "default" && !info.variants.includes(model.variant))
          issues.push({ rule, message: `${role} ${Match.resource(model)} has no such Variant` })
      })
      for (const [rule, { match, to }] of rules.entries()) {
        if (!RoutingSchema.conditions.some((key) => match[key] !== undefined))
          issues.push({ rule, message: "A routing rule needs at least one condition" })
        if (match.text !== undefined && Match.pattern(match.text) === undefined)
          issues.push({ rule, message: `Text pattern is not a valid regular expression: ${match.text.pattern}` })
        if (match.context?.min !== undefined && match.context.max !== undefined && match.context.min > match.context.max)
          issues.push({ rule, message: "Context minimum exceeds its maximum" })
        if (!RoutingSchema.isTiers(to)) {
          yield* known(rule, to, "Target")
          continue
        }
        const names = to.tiers.map((tier) => tier.name)
        if (new Set(names).size !== names.length) issues.push({ rule, message: "Tier names must be unique" })
        if (!names.includes(to.default)) issues.push({ rule, message: `Default Tier ${to.default} is not one of the Tiers` })
        for (const tier of to.tiers) yield* known(rule, tier.model, `Tier ${tier.name} Model`)
        yield* known(rule, to.judge.model, "Judge Model")
      }
      if (issues.length > 0) return yield* new InvalidError({ issues })
    })

    const names = Effect.map(config.get, (info) => {
      const seen = new Map<string, Model.Ref>()
      for (const rule of info.routing ?? []) {
        const model = rule.match.model
        if (model !== undefined && isAuto(model)) seen.set(model.id, { provider: model.provider, id: model.id })
      }
      return [...seen.values()]
    })

    return Service.of({ resolve, check, names })
  }),
)

/** Workspace Routing node beside the Catalog it consults. */
export const node = makeWorkspaceNode({
  service: Service,
  layer,
  deps: [Config.node, Catalog.node, KV.node],
})
