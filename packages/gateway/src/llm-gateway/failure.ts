import { Schema } from "effect"
import type { ModelError } from "@bymorning/schema/plugin-model"

/** LLM Gateway authentication failed. */
export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "LLMGateway.AuthenticationError",
  {},
) {}

/** A Provider-native request could not be parsed. */
export class InputError extends Schema.TaggedError<InputError>()("LLMGateway.InputError", {
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** A requested public Model is unavailable. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("LLMGateway.NotFoundError", {
  model: Schema.String,
}) {}

/** LLM Gateway policy denied the invocation. */
export class DeniedError extends Schema.TaggedError<DeniedError>()("LLMGateway.DeniedError", {
  reason: Schema.Literals(["model", "budget", "rate", "denied"]),
  /** Milliseconds until a rate-limit bucket becomes available. */
  retryAfter: Schema.optionalKey(Schema.Number),
}) {}

/** A required LLM Gateway capability is unavailable. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("LLMGateway.UnavailableError", {
  reason: Schema.String,
}) {}

/** The Provider exchange failed before response commitment. */
export class UpstreamError extends Schema.TaggedError<UpstreamError>()("LLMGateway.UpstreamError", {
  phase: Schema.Literals(["connect", "read"]),
  cause: Schema.Defect(),
}) {}

/** A Provider body failed after response commitment. */
export class StreamError extends Schema.TaggedError<StreamError>()("LLMGateway.StreamError", {
  cause: Schema.Defect(),
}) {}

/** Every typed failure LLM Gateway renders in a Provider-native envelope. */
export type Failure = AuthenticationError | InputError | NotFoundError | DeniedError | UnavailableError | UpstreamError

/** HTTP status LLM Gateway assigns to one typed failure before native rendering. */
export const status = (failure: Failure): number => {
  switch (failure._tag) {
    case "LLMGateway.AuthenticationError":
      return 401
    case "LLMGateway.InputError":
      return 400
    case "LLMGateway.NotFoundError":
      return 404
    case "LLMGateway.DeniedError":
      return failure.reason === "model" || failure.reason === "denied" ? 403 : 429
    case "LLMGateway.UnavailableError":
      return 503
    case "LLMGateway.UpstreamError":
      return 502
  }
}

/** Caller-safe message LLM Gateway renders for one typed failure. */
export const message = (failure: Failure): string => {
  switch (failure._tag) {
    case "LLMGateway.AuthenticationError":
      return "Authentication required"
    case "LLMGateway.InputError":
      return failure.reason
    case "LLMGateway.NotFoundError":
      return "Model not found"
    case "LLMGateway.DeniedError":
      return "Request denied"
    case "LLMGateway.UnavailableError":
      return "Service unavailable"
    case "LLMGateway.UpstreamError":
      return "Upstream request failed"
  }
}

/** Native HTTP Retry-After value for a rate refusal, rounded up to whole seconds. */
export const retryAfter = (failure: Failure): string | undefined =>
  failure._tag === "LLMGateway.DeniedError" && failure.retryAfter !== undefined
    ? String(Math.max(0, Math.ceil(failure.retryAfter / 1000)))
    : undefined

/** Project inference-hook failures into the caller-native Gateway failure vocabulary. */
export const modelFailure = (error: ModelError): DeniedError | UnavailableError =>
  error.reason === "unavailable"
    ? new UnavailableError({ reason: "Inference Plugin unavailable" })
    : new DeniedError({
        reason: error.reason,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      })
