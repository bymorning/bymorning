/**
 * The local backends shared by the development entry and the image's
 * evaluation selection: filesystem storage under BYMORNING_DATA_DIR and the
 * local cipher backend keyed by a 32-byte base64url master key. Neither is a
 * production backend; see app/host/README.md for what each gives up.
 */
import { Cipher } from "@bymorning/core/cipher"
import { Storage } from "@bymorning/core/storage"
import { NodeCrypto } from "@effect/platform-node"
import { Config, Effect, Redacted, Schema } from "effect"
import path from "node:path"
import { Host } from "./host.js"

export const directory = Config.schema(Schema.NonEmptyString, "BYMORNING_DATA_DIR")

/** Validate one base64url-encoded 32-byte key from a file or a secret variable. */
export const decodeKey = (key: string, setting: string) => {
  const trimmed = key.trim()
  return /^[A-Za-z0-9_-]+$/.test(trimmed) && Buffer.from(trimmed, "base64url").length === 32
    ? Effect.succeed(Redacted.make(trimmed))
    : Effect.fail(new Host.ConfigError({ setting, reason: "must contain 32 base64url-encoded bytes" }))
}

/** Filesystem storage under `$BYMORNING_DATA_DIR/storage`. */
export const filesystem: Host.StorageFactory = Effect.map(directory, (data) =>
  Storage.filesystem({ directory: path.join(data, "storage") }),
)

/** The local cipher backend for an already validated master key. */
export const cipher = (key: Redacted.Redacted<string>) =>
  Cipher.localBackend(key).pipe(Effect.provide(NodeCrypto.layer))

/** The local cipher backend keyed by the operator-supplied CIPHER_KEY; nothing is generated. */
export const supplied: Host.CipherFactory = Effect.gen(function* () {
  const key = yield* Config.redacted("CIPHER_KEY")
  return yield* cipher(yield* decodeKey(Redacted.value(key), "CIPHER_KEY"))
})
