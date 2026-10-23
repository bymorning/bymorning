import { NodeCrypto } from "@effect/platform-node"
import { Layer, Redacted } from "effect"
import { Cipher } from "../../src/cipher.js"

/** Deterministic local-backend Cipher layer for focused and integration tests. */
export const layer: Layer.Layer<Cipher.Service> = Cipher.local(
  Redacted.make(Buffer.alloc(32, 42).toString("base64url")),
).pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
