import { Cipher } from "@bymorning/core/cipher"
import { ServiceUnavailableError } from "@bymorning/protocol/errors"
import { Cause, Effect } from "effect"

/**
 * Present a Cipher refusal as the protocol's 503. Credential fails closed by
 * dying with `Cipher.UnavailableError` when the key backend cannot unwrap a
 * stored data key (a disabled or expired key version, an envelope from another
 * key, an unreachable backend), so a handler reading stored Credentials sees it
 * as a defect; this names that condition instead of a bare 500. The backend
 * already logged the specific reason; every other Cause maps to `fallback`.
 */
export const cipherFailure =
  <E>(fallback: () => E) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<never, E | ServiceUnavailableError> =>
    Cause.squash(cause) instanceof Cipher.UnavailableError
      ? Effect.logWarning("Credential key unavailable; the request was refused").pipe(
          Effect.andThen(Effect.fail(new ServiceUnavailableError({ message: "Credential key is unavailable" }))),
        )
      : Effect.fail(fallback())
