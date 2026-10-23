export * as SessionModelRequest from "./model-request.js"

import type { ModelRequestPurpose } from "@bymorning/plugin/session-hooks"
import { Agent } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import { Model } from "@bymorning/schema/model"
import { RoutingSchema } from "@bymorning/schema/routing"
import { Session } from "@bymorning/schema/session"
import type { Project } from "@bymorning/schema/project"
import { Cause, Effect, Option, Schema } from "effect"
import { PluginHooks } from "../plugin/hooks.js"
import { ModelResolver } from "../model-resolver.js"
import { Routing } from "../routing.js"

/** Identity required to plan one physical model request. */
export interface Input {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  /** Conversation facts for Routing conditions and the judge. */
  readonly digest?: Routing.Digest
  /** Tools completed earlier in the Session. */
  readonly tools?: ReadonlySet<string>
  /** Performs a judge inference; absent requests use a matched rule's default Tier. */
  readonly judge?: (request: Routing.JudgeRequest) => Effect.Effect<Routing.JudgeReply, unknown>
  /** A decision already made for this participant turn, reused instead of routing again. */
  readonly decided?: { readonly model: Model.Ref; readonly route: RoutingSchema.Route }
}

/** Validated and executable destination for one physical model request. */
export interface Plan {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  readonly model: Model.Ref
  /** The routing decision, when Routing chose or rewrote the Model. */
  readonly route?: RoutingSchema.Route
  readonly resolved: ModelResolver.Resolved
  readonly baseURL?: string
  readonly headers: Readonly<Record<string, string>>
}

/** A model request policy hook or routed destination could not be resolved. */
export class Failure extends Schema.TaggedError<Failure>()("SessionModelRequest.Failure", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const Output = Schema.Struct({
  model: Model.Ref,
  baseURL: Schema.optionalKey(Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
})

const callbackFailure = (cause: Cause.Cause<never>) =>
  Cause.hasInterrupts(cause)
    ? Effect.failCause(cause)
    : Effect.logError("Session model request planning failed", { cause }).pipe(
        Effect.andThen(
          Effect.fail(
            new Failure({
              message: "Session model request planning failed",
              cause,
            }),
          ),
        ),
      )

const invalid = (message: string, cause: unknown) => new Failure({ message, cause })

/**
 * Supply an optionally captured Routing service to `plan`. Production Session graphs always
 * capture Routing; focused graphs without it plan the requested Model unchanged and refuse Auto names.
 */
export const withRouting =
  (routing: Option.Option<Routing.Interface>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Option.isSome(routing) ? Effect.provideService(effect, Routing.Service, routing.value) : effect

/** Route, apply request policy, and resolve one executable physical model destination. */
export const plan = Effect.fn("SessionModelRequest.plan")(function* (input: Input) {
  const requestedModel = { ...input.requestedModel }
  const routed = yield* route(input)
  const output = yield* applyHooks(input, requestedModel, routed.model)
  if (Routing.isAuto(output.model))
    return yield* invalid(`Auto name ${output.model.id} can only be resolved by Routing.`, undefined)
  const resolved = yield* resolveDestination(output)
  return {
    purpose: input.purpose,
    sessionID: input.sessionID,
    ...(input.projectID === undefined ? {} : { projectID: input.projectID }),
    ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
    agent: input.agent,
    requestedModel: { ...requestedModel },
    model: { ...output.model },
    ...(routed.route === undefined || routed.route.cause === "none" ? {} : { route: routed.route }),
    resolved,
    ...(output.baseURL === undefined ? {} : { baseURL: output.baseURL }),
    headers: { ...output.headers },
  } satisfies Plan
})

const route = Effect.fn("SessionModelRequest.route")(function* (input: Input) {
  // The judge's own request is never routed, so it cannot recurse or be rewritten into an Auto name.
  if (input.purpose === "route") return { model: { ...input.requestedModel } }
  if (input.decided !== undefined) return { model: { ...input.decided.model }, route: input.decided.route }
  const routing = yield* Effect.serviceOption(Routing.Service)
  if (Option.isNone(routing)) return { model: { ...input.requestedModel } }
  const decision = yield* routing.value
    .resolve({
      requestedModel: input.requestedModel,
      purpose: input.purpose,
      agent: input.agent,
      ...(input.digest === undefined ? {} : { digest: input.digest }),
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      ...(input.judge === undefined ? {} : { judge: input.judge }),
    })
    .pipe(
      Effect.mapError((error) =>
        error._tag === "Routing.UnresolvedError"
          ? invalid(`No routing rule matches Auto name ${error.model.id}.`, error)
          : invalid(`No Tier of routing rule ${error.rule + 1} can serve this request.`, error),
      ),
    )
  return { model: decision.model, route: decision.route }
})

const applyHooks = Effect.fn("SessionModelRequest.applyHooks")(function* (
  input: Input,
  requestedModel: Model.Ref,
  model: Model.Ref,
) {
  const hooks = yield* PluginHooks.Service
  const routed = yield* hooks
    .trigger("session", "model.request", {
      purpose: input.purpose,
      sessionID: input.sessionID,
      ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
      agent: input.agent,
      requestedModel: { ...requestedModel },
      model: { ...model },
      headers: {},
    })
    .pipe(Effect.catchCause(callbackFailure))
  return yield* Schema.decodeUnknownEffect(Output)({
    model: routed.model,
    ...(routed.baseURL === undefined ? {} : { baseURL: routed.baseURL }),
    headers: routed.headers,
  }).pipe(Effect.mapError((cause) => invalid("Invalid Session model request policy output", cause)))
})

const resolveDestination = Effect.fn("SessionModelRequest.resolveDestination")(function* (output: typeof Output.Type) {
  const resolver = yield* ModelResolver.Service
  return yield* resolver.resolve(output).pipe(
    Effect.mapError((cause) => {
      const reason = {
        unavailable: "model is unavailable",
        "unknown-provider": "provider is not registered",
        "unknown-model": "model is not registered",
        "invalid-route": "endpoint is invalid",
        "transport-unsupported": "transport is unsupported",
        "region-unsupported": "model is unavailable in the connection's region",
        "connection-unavailable": "provider has no available connection",
      }[cause.reason]
      return invalid(`Routed model ${cause.model.provider}/${cause.model.id} cannot run: ${reason}.`, cause)
    }),
  )
})
