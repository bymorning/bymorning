/**
 * Azure selections: `STORAGE_PROVIDER=azure-blob` and `CIPHER_BACKEND=keyvault`.
 * Both require `AZURE_CLOUD` (no default) and accept only production endpoints
 * of that cloud. Blob Storage and Key Vault are reached with
 * DefaultAzureCredential (managed or workload identity), constructed here and
 * nowhere else.
 */
import { DefaultAzureCredential } from "@azure/identity"
import { ContainerClient } from "@azure/storage-blob"
import { blob as blobProvider } from "@bymorning/backend-azure/blob"
import { keyvault as keyvaultBackend } from "@bymorning/backend-azure/keyvault"
import { Config, Effect, Schema } from "effect"
import { Host } from "./host.js"

const cloud = Config.schema(Host.Cloud, "AZURE_CLOUD").pipe(Config.map((name) => Host.clouds[name]))

const credential = (authorityHost: string) =>
  Effect.try({
    try: () => new DefaultAzureCredential({ authorityHost }),
    catch: () => new Host.ConfigError({ setting: "AZURE_CLOUD", reason: "credential construction failed" }),
  })

/**
 * Blob Storage on STORAGE_CONTAINER under the STORAGE_ACCOUNT_URL account, for
 * example https://<account>.blob.core.windows.net.
 */
export const blob: Host.StorageFactory = Effect.gen(function* () {
  const selected = yield* cloud
  const accountURL = yield* Config.schema(Schema.NonEmptyString, "STORAGE_ACCOUNT_URL")
  const container = yield* Config.schema(Schema.NonEmptyString, "STORAGE_CONTAINER")
  yield* Host.endpoint(accountURL, "STORAGE_ACCOUNT_URL", selected.blob, /^\/$/)
  const token = yield* credential(selected.authorityHost)
  const client = yield* Effect.try({
    try: () =>
      new ContainerClient(`${accountURL.replace(/\/$/, "")}/${container}`, token, {
        // The JS SDK passes audience verbatim as a scope (including /.default).
        // Microsoft documents this resource for all public and sovereign clouds.
        audience: "https://storage.azure.com/.default",
      }),
    catch: () => new Host.ConfigError({ setting: "STORAGE_CONTAINER", reason: "container client construction failed" }),
  })
  return blobProvider({ container, client })
})

/**
 * Key Vault cipher backend over the key URL in KEY_VAULT_KEY
 * (https://<vault>.vault.azure.net/keys/<name>[/<version>]); an unversioned URL
 * resolves to the latest key version at startup and fails closed when the vault
 * is unreachable.
 */
export const keyvault: Host.CipherFactory = Effect.gen(function* () {
  const selected = yield* cloud
  const key = yield* Config.schema(Schema.NonEmptyString, "KEY_VAULT_KEY")
  yield* Host.endpoint(key, "KEY_VAULT_KEY", selected.vault, /^\/keys\/[a-zA-Z0-9-]{1,127}(\/[0-9a-f]{32})?$/)
  const token = yield* credential(selected.authorityHost)
  return yield* keyvaultBackend({ key, credential: token })
})
