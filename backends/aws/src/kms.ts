/**
 * AWS KMS Cipher backend: envelope data keys from GenerateDataKey on one
 * symmetric CMK, unwrapped with Decrypt. Both calls carry the constant
 * encryption context, so IAM can scope the task role to this authority with a
 * kms:EncryptionContext condition. The envelope keyID must equal the configured
 * ARN; Decrypt always names that configured ARN, never a database value.
 * Internally created clients resolve region, credentials, and FIPS endpoints
 * from the standard AWS SDK environment (AWS_REGION, AWS_USE_FIPS_ENDPOINT —
 * set in the deployment image).
 */
import { DecryptCommand, GenerateDataKeyCommand, KMSClient, type KMSClientConfig } from "@aws-sdk/client-kms"
import { Data, Effect } from "effect"
import { Cipher } from "@bymorning/core/cipher"

/**
 * Authenticated, non-secret context attached to every KMS call. Keep in sync
 * with the installer task-role condition `kms:EncryptionContext:bymorning`.
 */
export const context = { bymorning: "cipher" } as const

/** The SDK error class name when it is one identifier, otherwise `unknown`. */
const errorName = (cause: unknown) =>
  cause instanceof Error && /^[A-Za-z0-9_]+$/.test(cause.name) ? cause.name : "unknown"

/** A KMS call failed; carries only the SDK error class name. Private: callers see Cipher.UnavailableError. */
class RequestError extends Data.TaggedError("RequestError")<{ readonly kind: string }> {}

/** AWS KMS Cipher backend over one symmetric CMK. */
export const kms = (options: {
  /** ARN of the symmetric CMK wrapping data keys (CREDENTIAL_KMS_KEY). */
  readonly arn: string
  readonly region?: string
  /** Caller-owned client (tests); its lifecycle stays with the caller. */
  readonly client?: KMSClient
}): Effect.Effect<Cipher.Backend, Cipher.UnavailableError> =>
  Effect.gen(function* () {
    const client =
      options.client ??
      (yield* Effect.try({
        try: () =>
          new KMSClient(options.region === undefined ? {} : ({ region: options.region } satisfies KMSClientConfig)),
        catch: () => new Cipher.UnavailableError({}),
      }))

    // A failed call leaves one trace naming the operation and the SDK error
    // class (`AccessDeniedException`, `KMSInternalException`, a network error
    // name); the message, request id, and key material stay out of the log.
    const send = <A>(operation: "generate" | "unwrap", command: () => Promise<A>) =>
      Effect.tryPromise({ try: command, catch: (cause) => new RequestError({ kind: errorName(cause) }) }).pipe(
        Effect.tapError((error) => Effect.logWarning("KMS request failed", { operation, name: error.kind })),
        Effect.mapError(() => new Cipher.UnavailableError({})),
        Effect.withSpan(`Cipher.kms.${operation}`, { attributes: { key: options.arn } }),
      )

    return {
      keyID: options.arn,
      generate: send("generate", () =>
        client.send(new GenerateDataKeyCommand({ KeyId: options.arn, KeySpec: "AES_256", EncryptionContext: context })),
      ).pipe(
        Effect.flatMap((response) =>
          response.Plaintext === undefined || response.CiphertextBlob === undefined
            ? new Cipher.UnavailableError({})
            : Effect.succeed({ key: response.Plaintext, dataKey: response.CiphertextBlob }),
        ),
      ),
      // The refusal names the configured key, never the envelope's identity,
      // which is a database value.
      unwrap: (dataKey, keyID) =>
        keyID !== options.arn
          ? Effect.logWarning("Cipher refused a data key wrapped by another key", {
              reason: "foreign-key",
              keyID: options.arn,
            }).pipe(Effect.andThen(new Cipher.UnavailableError({})))
          : send("unwrap", () =>
              client.send(
                new DecryptCommand({ CiphertextBlob: dataKey, KeyId: options.arn, EncryptionContext: context }),
              ),
            ).pipe(
              Effect.flatMap((response) =>
                response.Plaintext === undefined ? new Cipher.UnavailableError({}) : Effect.succeed(response.Plaintext),
              ),
            ),
    } satisfies Cipher.Backend
  })
