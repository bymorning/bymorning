import { Schema } from "effect"

/**
 * The selected evidence cannot admit an available Account. Callback reasons:
 * `state` (state differs from the attempt), `response` (the authorization
 * response carried no usable code), `exchange` (the token endpoint was
 * unreachable or refused the code), `token` (the ID token or its signature
 * did not validate), `email-missing` (no email in the ID token or userinfo),
 * and `callback` (any other callback mismatch).
 */
export class RejectedError extends Schema.TaggedError<RejectedError>()("Auth.RejectedError", {
  reason: Schema.Literals([
    "email-domain",
    "email-unverified",
    "email-missing",
    "provider-missing",
    "provider-disabled",
    "provider-changed",
    "local-disabled",
    "account-unavailable",
    "session-revoked",
    "session-idle",
    "provisioning",
    "state",
    "response",
    "exchange",
    "token",
    "callback",
  ]),
  message: Schema.optionalKey(Schema.String),
}) {}

/** Ordinary database or configuration failure during Auth. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Auth.UnavailableError", {
  operation: Schema.Literals(["open", "complete", "authenticate", "end", "list", "revoke", "resolve"]),
  message: Schema.String,
}) {}

/** A login attempt or Login Session is no longer valid. */
export class ExpiredError extends Schema.TaggedError<ExpiredError>()("Auth.ExpiredError", {
  reason: Schema.Literals(["attempt", "session"]),
  message: Schema.String,
}) {}

/** The addressed Login Session does not exist for the calling Account. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Auth.NotFoundError", {}) {}
