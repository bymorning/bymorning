/**
 * The host startup contract: `Host.resolve` over the selection matrix and every
 * rule in app/host/README.md, one real boot per cloud pair, and `migrate`. The
 * cloud SDKs are the recording stand-ins aliased in vitest.config.ts, so no
 * AWS or Azure credential or network is involved.
 */
import { DefaultAzureCredential } from "@azure/identity"
import { Storage } from "@bymorning/core/storage"
import { TestDatabase } from "@bymorning/testing/database"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { it } from "@effect/vitest"
import { Cause, Config, ConfigProvider, Context, Effect, Layer, Logger, Redacted } from "effect"
import { HttpServer } from "effect/unstable/http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, vi } from "vitest"
import { Application } from "../../../packages/server/src/application.js"
import { Postgres } from "../../../packages/server/src/application/adapters/database-postgres.js"
import { load as loadConfiguration } from "../../../packages/server/src/application/configuration.js"
import { WebCookie } from "../../../packages/server/src/web-cookie.js"
import * as Dev from "../src/dev.js"
import { Host } from "../src/host.js"
import * as Index from "../src/index.js"
import { selection as production } from "../src/production.js"
import { KMSClient } from "./aws-sdk-kms.js"
import { S3Client } from "./aws-sdk-s3.js"
import { CryptographyClient, KeyClient, resolvedVersion } from "./azure-keyvault-keys.js"
import { ContainerClient } from "./azure-storage-blob.js"

vi.mock("@azure/identity", async (original) => {
  const actual = await original<typeof import("@azure/identity")>()
  return {
    ...actual,
    DefaultAzureCredential: vi.fn(function (options) {
      return new actual.DefaultAzureCredential({ ...options })
    }),
  }
})
vi.mock("../../../packages/server/src/application/adapters/database-postgres.js", async (original) => {
  const actual =
    await original<typeof import("../../../packages/server/src/application/adapters/database-postgres.js")>()
  return { ...actual, Postgres: { ...actual.Postgres, node: vi.fn(actual.Postgres.node) } }
})

const directories: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  S3Client.reset()
  KMSClient.reset()
  ContainerClient.reset()
  CryptographyClient.reset()
  KeyClient.reset()
})
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const scratch = async (prefix: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

type Environment = Record<string, string | undefined>
const provide = (environment: Environment) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment)))
const resolveWith = <R>(environment: Environment, selection: Host.Selection<R>) =>
  Host.resolve(selection).pipe(provide(environment))
const resolve = (environment: Environment) => resolveWith<never>(environment, production)
const refuse = (environment: Environment) => resolve(environment).pipe(Effect.flip)
const document = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url))
/** Open the resolved storage dependency the way the Application does and return the selected provider. */
const openStorage = (input: Effect.Success<ReturnType<typeof resolve>>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(LayerNode.compile(input.deps.storage))
    const storage = Context.get(context, Storage.Service)
    return { selected: yield* storage.default(), inventory: yield* storage.list() }
  }).pipe(Effect.scoped)

/** Record every log entry one effect emits, replacing the default logger. */
const captureLogs = () => {
  const entries: Array<{ readonly level: string; readonly message: ReadonlyArray<unknown> }> = []
  const logger = Logger.make((input) => {
    entries.push({ level: input.logLevel, message: Array.isArray(input.message) ? input.message : [input.message] })
  })
  return { entries, layer: Logger.layer([logger], { mergeWithExisting: false }) }
}

const cookieKey = Buffer.alloc(32).toString("base64url")
const keyUUID = "00000000-0000-4000-8000-000000000000"
const kmsARN = `arn:aws:kms:us-east-1:123456789012:key/${keyUUID}`
const keyVersion = "8f3a2c1b4d5e6f708192a3b4c5d6e7f8"
const keyURL = `https://bymorning.vault.azure.net/keys/credential/${keyVersion}`
const common = {
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://unused@localhost/test",
  WEB_COOKIE_KEY: cookieKey,
}
const aws = {
  ...common,
  STORAGE_PROVIDER: "s3",
  CIPHER_BACKEND: "kms",
  STORAGE_BUCKET: "test-bucket",
  AWS_REGION: "us-east-1",
  CREDENTIAL_KMS_KEY: kmsARN,
  // Referenced by the default installation document (AgentCore).
  CODE_INTERPRETER_ID: "test-resource",
}
const azure = {
  ...common,
  STORAGE_PROVIDER: "azure-blob",
  CIPHER_BACKEND: "keyvault",
  AZURE_CLOUD: "AzureCloud",
  STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.windows.net",
  STORAGE_CONTAINER: "bymorning",
  KEY_VAULT_KEY: keyURL,
  BYMORNING_CONFIG: document("bymorning.azure.jsonc"),
}
const seed = {
  AUTH_ISSUER: "https://auth.example.com",
  AUTH_CLIENT_ID: "fixture-client",
  AUTH_CLIENT_SECRET: "private-marker",
  AUTH_PROVIDER: "google",
  AUTH_EMAIL_DOMAINS: "example.com",
}

describe("the production selection", () => {
  it.effect("s3 + kms resolves the AWS deployment shape", () =>
    Effect.gen(function* () {
      const input = yield* resolve(aws)
      const { settings } = input
      expect(settings.host).toBe("0.0.0.0")
      expect(settings.port).toBe(3210)
      expect(settings.cookiePolicy).toBe(WebCookie.secure)
      expect(settings.allowedEmailDomains).toEqual([])
      expect(settings.installPackage).toBe(false)
      expect(settings.local).toBeUndefined()
      expect(settings.seed).toBeUndefined()
      expect(settings.tls).toBeUndefined()
      expect(settings.directory).toBe(path.join(tmpdir(), "bymorning"))
      // The default installation document is the packaged bymorning.jsonc with
      // the deployment's AgentCore references substituted.
      expect(String(settings.configuration?.[0]?.path)).toBe(document("bymorning.jsonc"))
      expect(settings.configuration?.[0]?.info).toMatchObject({
        plugins: [
          "@bymorning/plugin-google",
          "@bymorning/plugin-share",
          {
            package: "@bymorning/plugin-code-interpreter-agentcore",
            options: { identifier: "test-resource", region: "us-east-1" },
          },
        ],
        code_interpreter: { implementation: "agentcore" },
      })
      // The KMS key ARN and Region reach the SDK boundary unchanged.
      expect(settings.cipher.keyID).toBe(kmsARN)
      expect(KMSClient.clients[0]?.config).toMatchObject({ region: "us-east-1" })
      // The provider inventory is the public Storage contract; init probes the bucket.
      const storage = yield* openStorage(input)
      expect(storage.selected).toEqual({ id: "s3", name: "S3" })
      expect(storage.inventory).toEqual([{ id: "s3", name: "S3" }])
      expect(S3Client.clients[0]?.config).toMatchObject({ region: "us-east-1" })
      expect(S3Client.clients[0]?.sent).toEqual([{ name: "HeadBucketCommand", input: { Bucket: "test-bucket" } }])
      expect(ContainerClient.clients).toHaveLength(0)
      expect(DefaultAzureCredential).not.toHaveBeenCalled()
      expect(() => LayerNode.compile(Application.node(input))).not.toThrow()
    }),
  )

  it.effect.each([
    ["AzureCloud", "windows.net", "azure.net", "com"],
    ["AzureUSGovernment", "usgovcloudapi.net", "usgovcloudapi.net", "us"],
  ])("azure-blob + keyvault on %s resolves the Azure deployment shape", ([cloud, storage, vault, login]) =>
    Effect.gen(function* () {
      const environment = {
        ...azure,
        AZURE_CLOUD: cloud,
        STORAGE_ACCOUNT_URL: `https://bymorning.blob.core.${storage}`,
        KEY_VAULT_KEY: `https://bymorning.vault.${vault}/keys/credential`,
        AUTH_ISSUER: `https://login.microsoftonline.${login}/tenant/v2.0`,
        AUTH_CLIENT_ID: "fixture-client",
        AUTH_CLIENT_SECRET: "fixture-secret",
        AUTH_PROVIDER: "microsoft",
        AUTH_EMAIL_DOMAINS: "example.test",
      }
      const input = yield* resolve(environment)
      // Each selection builds its own credential for the selected cloud's authority.
      expect(vi.mocked(DefaultAzureCredential).mock.calls).toEqual([
        [{ authorityHost: `https://login.microsoftonline.${login}` }],
        [{ authorityHost: `https://login.microsoftonline.${login}` }],
      ])
      expect(input.settings.seed).toMatchObject({ kind: "microsoft", displayName: "Microsoft Entra" })
      // An unversioned key URL resolves to the latest version through the KeyClient.
      expect(input.settings.cipher.keyID).toBe(`https://bymorning.vault.${vault}/keys/credential/${resolvedVersion}`)
      expect(KeyClient.clients[0]?.vaultUrl).toBe(`https://bymorning.vault.${vault}`)
      expect(CryptographyClient.clients[0]?.credential).toBe(vi.mocked(DefaultAzureCredential).mock.results[1]?.value)
      expect(ContainerClient.clients[0]?.credentialOrContainerName).toBe(
        vi.mocked(DefaultAzureCredential).mock.results[0]?.value,
      )
      expect(ContainerClient.clients[0]?.options).toEqual({ audience: "https://storage.azure.com/.default" })
      expect(ContainerClient.clients[0]?.urlOrConnectionString).toBe(`https://bymorning.blob.core.${storage}/bymorning`)
      const opened = yield* openStorage(input)
      expect(opened.selected).toEqual({ id: "azure-blob", name: "Azure Blob" })
      expect(ContainerClient.clients[0]?.calls).toEqual([{ name: "getProperties" }])
      expect(S3Client.clients).toHaveLength(0)
      expect(KMSClient.clients).toHaveLength(0)
      expect(input.settings.configuration?.[0]?.info.code_interpreter).toBeUndefined()
      expect(() => LayerNode.compile(Application.node(input))).not.toThrow()
    }),
  )

  it.effect("azure-blob + keyvault with a versioned key keeps the key identifier", () =>
    Effect.gen(function* () {
      const input = yield* resolve(azure)
      expect(input.settings.cipher.keyID).toBe(keyURL)
      expect(CryptographyClient.clients[0]?.key).toBe(keyURL)
      expect(KeyClient.clients).toHaveLength(0)
    }),
  )

  it.effect("s3 + keyvault is a permitted mixed selection", () =>
    Effect.gen(function* () {
      const input = yield* resolve({
        ...aws,
        CIPHER_BACKEND: "keyvault",
        CREDENTIAL_KMS_KEY: undefined,
        AZURE_CLOUD: "AzureCloud",
        KEY_VAULT_KEY: keyURL,
      })
      expect(input.settings.cipher.keyID).toBe(keyURL)
      expect((yield* openStorage(input)).selected.id).toBe("s3")
      expect(KMSClient.clients).toHaveLength(0)
    }),
  )

  it.effect("azure-blob + kms is a permitted mixed selection", () =>
    Effect.gen(function* () {
      const input = yield* resolve({
        ...azure,
        CIPHER_BACKEND: "kms",
        KEY_VAULT_KEY: undefined,
        AWS_REGION: "us-east-1",
        CREDENTIAL_KMS_KEY: kmsARN,
      })
      expect(input.settings.cipher.keyID).toBe(kmsARN)
      expect((yield* openStorage(input)).selected.id).toBe("azure-blob")
      expect(CryptographyClient.clients).toHaveLength(0)
    }),
  )

  it.effect.each(["STORAGE_PROVIDER", "CIPHER_BACKEND"])("a missing %s is refused naming it", (setting) =>
    Effect.gen(function* () {
      for (const value of [undefined, ""]) {
        const error = yield* refuse({ ...aws, [setting]: value })
        expect(error).toMatchObject({ _tag: "Host.ConfigError", setting })
        expect(String(error)).toContain(setting)
      }
    }),
  )

  it.effect("an unknown selector value is refused listing the offered values", () =>
    Effect.gen(function* () {
      const storage = yield* refuse({ ...aws, STORAGE_PROVIDER: "filesystem" })
      expect(storage).toMatchObject({ _tag: "Host.ConfigError", setting: "STORAGE_PROVIDER" })
      expect(String(storage)).toContain("is not one of s3, azure-blob")
      // The refused value is never echoed; only the setting and what it offers.
      expect(String(storage)).not.toContain("filesystem")
      const cipher = yield* refuse({ ...aws, CIPHER_BACKEND: "local-marker" })
      expect(cipher).toMatchObject({ _tag: "Host.ConfigError", setting: "CIPHER_BACKEND" })
      expect(String(cipher)).toContain("is not one of kms, keyvault")
      expect(String(cipher)).not.toContain("local-marker")
      // Object prototype names are not implementations.
      expect(yield* refuse({ ...aws, STORAGE_PROVIDER: "constructor" })).toMatchObject({ setting: "STORAGE_PROVIDER" })
    }),
  )

  const companions: Array<[string, string, Environment]> = [
    ["s3", "STORAGE_BUCKET", aws],
    ["s3", "AWS_REGION", aws],
    ["kms", "CREDENTIAL_KMS_KEY", aws],
    ["azure-blob", "STORAGE_ACCOUNT_URL", azure],
    ["azure-blob", "STORAGE_CONTAINER", azure],
    ["azure-blob", "AZURE_CLOUD", azure],
    ["keyvault", "KEY_VAULT_KEY", azure],
    ["keyvault", "AZURE_CLOUD", { ...aws, CIPHER_BACKEND: "keyvault", KEY_VAULT_KEY: keyURL }],
    ["every", "APP_ORIGIN", aws],
    ["every", "DATABASE_URL", aws],
    ["every", "WEB_COOKIE_KEY", aws],
  ]
  it.effect.each(companions)("the %s selection refuses a missing %s", ([, setting, environment]) =>
    Effect.gen(function* () {
      for (const value of [undefined, ""]) {
        const error = yield* refuse({ ...environment, [setting]: value })
        expect(String(error)).toContain(setting)
        // The refusing selection constructs nothing; storage resolves before cipher.
        expect(CryptographyClient.clients).toHaveLength(0)
        expect(KeyClient.clients).toHaveLength(0)
        expect(KMSClient.clients).toHaveLength(0)
        if (setting !== "KEY_VAULT_KEY") expect(DefaultAzureCredential).not.toHaveBeenCalled()
      }
    }),
  )

  it.effect("AZURE_CLOUD has no default: the Azure selection without it names the setting", () =>
    Effect.gen(function* () {
      const error = yield* refuse({ ...azure, AZURE_CLOUD: undefined })
      expect(String(error)).toContain("AZURE_CLOUD")
      expect(ContainerClient.clients).toHaveLength(0)
    }),
  )

  it.effect.each([
    { AZURE_CLOUD: "AzureChinaCloud" },
    { STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.usgovcloudapi.net" },
    { KEY_VAULT_KEY: "https://bymorning.vault.usgovcloudapi.net/keys/credential" },
    { STORAGE_ACCOUNT_URL: "http://127.0.0.1:10000/devstoreaccount1" },
    { STORAGE_ACCOUNT_URL: "http://bymorning.blob.core.windows.net" },
    { STORAGE_ACCOUNT_URL: "https://user:private-marker@bymorning.blob.core.windows.net" },
    { STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.windows.net?sig=private-marker" },
    { STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.windows.net/extra" },
    { STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.windows.net.evil.test" },
    { STORAGE_ACCOUNT_URL: "https://bymorning.blob.core.windows.net:444" },
    { KEY_VAULT_KEY: keyURL + "?sig=private-marker" },
    { KEY_VAULT_KEY: keyURL + "#private-marker" },
    { KEY_VAULT_KEY: keyURL.replace("https:", "http:") },
    { KEY_VAULT_KEY: keyURL.replace("https://", "https://user:private-marker@") },
    { KEY_VAULT_KEY: keyURL + "/extra" },
  ])("rejects unsafe or wrong-cloud Azure endpoints: %j", (extra) =>
    Effect.gen(function* () {
      const [setting] = Object.keys(extra)
      const error = yield* refuse({ ...azure, ...extra })
      expect(String(error)).toContain(setting!)
      expect(String(error)).not.toContain("private-marker")
      // Nothing is constructed for the refused endpoint; the storage selection
      // (resolved first) may already hold its credential when the key is refused.
      expect(CryptographyClient.clients).toHaveLength(0)
      expect(KeyClient.clients).toHaveLength(0)
      if (setting !== "KEY_VAULT_KEY") {
        expect(ContainerClient.clients).toHaveLength(0)
        expect(DefaultAzureCredential).not.toHaveBeenCalled()
      }
    }),
  )

  it.effect("a Microsoft AUTH_ISSUER must belong to the selected cloud", () =>
    Effect.gen(function* () {
      const microsoft = {
        AUTH_CLIENT_ID: "fixture-client",
        AUTH_CLIENT_SECRET: "private-marker",
        AUTH_PROVIDER: "microsoft",
        AUTH_EMAIL_DOMAINS: "example.test",
      }
      const error = yield* refuse({
        ...azure,
        ...microsoft,
        AUTH_ISSUER: "https://login.microsoftonline.us/tenant/v2.0",
      })
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "AUTH_ISSUER" })
      expect(String(error)).not.toContain("private-marker")
      expect(DefaultAzureCredential).not.toHaveBeenCalled()
      // Without AZURE_CLOUD (an AWS selection) either known authority is accepted.
      for (const login of ["com", "us"]) {
        const input = yield* resolve({
          ...aws,
          ...microsoft,
          AUTH_ISSUER: `https://login.microsoftonline.${login}/tenant/v2.0`,
        })
        expect(input.settings.seed?.issuer).toBe(`https://login.microsoftonline.${login}/tenant/v2.0`)
      }
      const other = yield* refuse({ ...aws, ...microsoft, AUTH_ISSUER: "https://login.example.com/tenant/v2.0" })
      expect(other).toMatchObject({ setting: "AUTH_ISSUER" })
    }),
  )

  it.effect("a KMS key ARN must be a full key ARN in AWS_REGION; the message echoes no value", () =>
    Effect.gen(function* () {
      const mismatch = yield* refuse({
        ...aws,
        CREDENTIAL_KMS_KEY: `arn:aws:kms:us-west-2:123456789012:key/${keyUUID}`,
      })
      expect(mismatch).toMatchObject({ _tag: "Host.ConfigError", setting: "CREDENTIAL_KMS_KEY" })
      expect(String(mismatch)).toContain("must equal AWS_REGION")
      expect(String(mismatch)).not.toContain("us-west-2")
      expect(String(mismatch)).not.toContain("us-east-1")
      expect(KMSClient.clients).toHaveLength(0)
    }),
  )

  it.effect.each([
    ["an alias ARN", `arn:aws:kms:us-east-1:123456789012:alias/credential`, "us-east-1"],
    ["a bare key id", keyUUID, "us-east-1"],
    ["a key name instead of a key id", "arn:aws:kms:us-east-1:123456789012:key/credential", "us-east-1"],
    ["a short account", `arn:aws:kms:us-east-1:1234:key/${keyUUID}`, "us-east-1"],
    ["another partition", `arn:aws-cn:kms:us-east-1:123456789012:key/${keyUUID}`, "us-east-1"],
    [
      "the GovCloud partition for a commercial Region",
      `arn:aws-us-gov:kms:us-east-1:123456789012:key/${keyUUID}`,
      "us-east-1",
    ],
    [
      "the commercial partition for a GovCloud Region",
      `arn:aws:kms:us-gov-west-1:123456789012:key/${keyUUID}`,
      "us-gov-west-1",
    ],
  ])("CREDENTIAL_KMS_KEY refuses %s", ([, arn, region]) =>
    Effect.gen(function* () {
      const error = yield* refuse({
        ...aws,
        CREDENTIAL_KMS_KEY: arn,
        AWS_REGION: region,
        AWS_USE_FIPS_ENDPOINT: "true",
      })
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "CREDENTIAL_KMS_KEY" })
      expect(String(error)).not.toContain("123456789012")
      expect(String(error)).not.toContain(keyUUID)
      expect(KMSClient.clients).toHaveLength(0)
    }),
  )

  const govcloud = {
    ...aws,
    AWS_REGION: "us-gov-west-1",
    CREDENTIAL_KMS_KEY: `arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/${keyUUID}`,
  }

  it.effect("a GovCloud Region requires AWS_USE_FIPS_ENDPOINT=true", () =>
    Effect.gen(function* () {
      const error = yield* refuse(govcloud)
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "AWS_USE_FIPS_ENDPOINT" })
      expect(yield* refuse({ ...govcloud, AWS_USE_FIPS_ENDPOINT: "false" })).toMatchObject({
        setting: "AWS_USE_FIPS_ENDPOINT",
      })
      const input = yield* resolve({ ...govcloud, AWS_USE_FIPS_ENDPOINT: "true" })
      expect(input.settings.cipher.keyID).toBe(govcloud.CREDENTIAL_KMS_KEY)
      expect(KMSClient.clients.at(-1)?.config).toMatchObject({ region: "us-gov-west-1" })
    }),
  )

  it.effect("the GovCloud FIPS rule applies to any selection with a us-gov-* AWS_REGION (Bedrock from Azure)", () =>
    Effect.gen(function* () {
      const error = yield* refuse({ ...azure, AWS_REGION: "us-gov-west-1" })
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "AWS_USE_FIPS_ENDPOINT" })
      expect(yield* refuse({ ...azure, AWS_REGION: "us-gov-east-1", AWS_USE_FIPS_ENDPOINT: "false" })).toMatchObject({
        setting: "AWS_USE_FIPS_ENDPOINT",
      })
      // The rule refuses before any client is constructed.
      expect(ContainerClient.clients).toHaveLength(0)
      expect(CryptographyClient.clients).toHaveLength(0)
      const input = yield* resolve({ ...azure, AWS_REGION: "us-gov-west-1", AWS_USE_FIPS_ENDPOINT: "true" })
      expect(input.settings.cipher.keyID).toBe(keyURL)
      // A commercial Region needs no flag, on either selection.
      yield* resolve({ ...azure, AWS_REGION: "us-east-1" })
      yield* resolve(aws)
    }),
  )

  it.effect.each(["TRUE", "True", "yes", "1", "enabled", " true"])(
    'AWS_USE_FIPS_ENDPOINT accepts exactly "true" or "false": %j is refused on every selection',
    (value) =>
      Effect.gen(function* () {
        for (const environment of [aws, azure, { ...govcloud }]) {
          const error = yield* refuse({ ...environment, AWS_USE_FIPS_ENDPOINT: value })
          expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "AWS_USE_FIPS_ENDPOINT" })
          expect(String(error)).toContain('must be "true" or "false"')
          expect(String(error)).not.toContain(value)
        }
        expect(KMSClient.clients).toHaveLength(0)
        expect(CryptographyClient.clients).toHaveLength(0)
        // Both literal values are accepted outside GovCloud.
        yield* resolve({ ...aws, AWS_USE_FIPS_ENDPOINT: "false" })
        yield* resolve({ ...azure, AWS_USE_FIPS_ENDPOINT: "true" })
      }),
  )

  it.effect("the image refuses a plain-HTTP APP_ORIGIN, loopback included", () =>
    Effect.gen(function* () {
      const error = yield* refuse({ ...aws, APP_ORIGIN: "http://app.example.com" })
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "APP_ORIGIN" })
      expect(error.message).toBe("APP_ORIGIN: must be an https origin")
      for (const origin of ["http://localhost:3210", "http://127.0.0.1", "http://[::1]:8080"]) {
        const loopback = yield* refuse({ ...aws, APP_ORIGIN: origin })
        expect(loopback).toMatchObject({ _tag: "Host.ConfigError", setting: "APP_ORIGIN" })
        expect(String(loopback)).not.toContain(origin)
        expect(yield* refuse({ ...azure, APP_ORIGIN: origin })).toMatchObject({ setting: "APP_ORIGIN" })
      }
      expect(KMSClient.clients).toHaveLength(0)
      expect(ContainerClient.clients).toHaveLength(0)
      expect((yield* resolve(aws)).settings.cookiePolicy).toBe(WebCookie.secure)
      expect(String(yield* refuse({ ...aws, APP_ORIGIN: "https://app.example.com/path" }))).toContain("APP_ORIGIN")
    }),
  )

  it.effect("resolution logs one line naming the live backends", () =>
    Effect.gen(function* () {
      const logs = captureLogs()
      yield* resolve({ ...govcloud, AWS_USE_FIPS_ENDPOINT: "true" }).pipe(Effect.provide(logs.layer))
      const resolved = logs.entries.filter((entry) => entry.message[0] === "Host resolved")
      expect(resolved).toHaveLength(1)
      expect(resolved[0]?.message[1]).toEqual({
        storage: "s3",
        cipher: govcloud.CREDENTIAL_KMS_KEY,
        cloud: "-",
        region: "us-gov-west-1",
        fips: "true",
      })
      const azureLogs = captureLogs()
      yield* resolve(azure).pipe(Effect.provide(azureLogs.layer))
      expect(azureLogs.entries.find((entry) => entry.message[0] === "Host resolved")?.message[1]).toEqual({
        storage: "azure-blob",
        cipher: keyURL,
        cloud: "AzureCloud",
        region: "-",
        fips: "false",
      })
      // No secret reaches the line: the cookie key and database URL are absent from every entry.
      for (const entry of [...logs.entries, ...azureLogs.entries]) {
        expect(JSON.stringify(entry.message)).not.toContain(cookieKey)
        expect(JSON.stringify(entry.message)).not.toContain("unused@localhost")
      }
    }),
  )

  it.effect("serves HTTPS when TLS_CERT and TLS_KEY are both set and refuses one without the other", () =>
    Effect.gen(function* () {
      const input = yield* resolve({ ...aws, TLS_CERT: "-----BEGIN CERTIFICATE-----", TLS_KEY: "pem-key" })
      expect(input.settings.tls?.cert).toBe("-----BEGIN CERTIFICATE-----")
      expect(Redacted.value(input.settings.tls!.key)).toBe("pem-key")
      expect(JSON.stringify(input.settings.tls)).not.toContain("pem-key")
      for (const partial of [{ TLS_CERT: "-----BEGIN CERTIFICATE-----" }, { TLS_KEY: "pem-key" }]) {
        const error = yield* refuse({ ...aws, ...partial })
        expect(String(error)).toContain("TLS_")
        expect(String(error)).not.toContain("pem-key")
      }
    }),
  )

  it.effect("listens on 0.0.0.0:3210 by default and honors HOST and PORT", () =>
    Effect.gen(function* () {
      const defaults = yield* resolve(aws)
      expect(defaults.settings.host).toBe("0.0.0.0")
      expect(defaults.settings.port).toBe(3210)
      const overridden = yield* resolve({ ...aws, HOST: "127.0.0.1", PORT: "4001" })
      expect(overridden.settings.host).toBe("127.0.0.1")
      expect(overridden.settings.port).toBe(4001)
      expect(String(yield* refuse({ ...aws, PORT: "70000" }))).toContain("PORT")
    }),
  )

  it.effect("passes hardening settings through and parses TRUSTED_PROXIES", () =>
    Effect.gen(function* () {
      const input = yield* resolve({
        ...aws,
        TRUSTED_PROXIES: " 10.0.0.0/8, 172.16.0.0/12 ,,",
        SETUP_TOKEN: "private-marker",
        LOGIN_BANNER: "Authorized use only",
      })
      expect(input.settings.trustedProxies).toEqual(["10.0.0.0/8", "172.16.0.0/12"])
      expect(input.settings.banner).toBe("Authorized use only")
      expect(Redacted.value(input.settings.setupToken!)).toBe("private-marker")
      expect(JSON.stringify(input.settings)).not.toContain("private-marker")
      const plain = yield* resolve(aws)
      expect(plain.settings.trustedProxies).toBeUndefined()
      expect(plain.settings.banner).toBeUndefined()
      expect(plain.settings.setupToken).toBeUndefined()
    }),
  )

  it.effect("decodes a full AUTH_* seed and refuses a partial one", () =>
    Effect.gen(function* () {
      const input = yield* resolve({ ...aws, ...seed })
      expect(input.settings.seed).toMatchObject({
        kind: "google",
        displayName: "Google Workspace",
        issuer: "https://auth.example.com",
        clientID: "fixture-client",
        domains: ["example.com"],
      })
      expect(Redacted.value(input.settings.seed!.clientSecret)).toBe("private-marker")
      expect(JSON.stringify(input.settings.seed)).not.toContain("private-marker")
      const error = yield* refuse({ ...aws, AUTH_ISSUER: "https://auth.example.com" })
      expect(String(error)).toContain("AUTH_")
    }),
  )

  it.effect("passes DATABASE_CA to the PostgreSQL adapter", () =>
    Effect.gen(function* () {
      const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
      yield* resolve({ ...azure, DATABASE_CA: pem })
      const call = vi.mocked(Postgres.node).mock.calls.at(-1)
      expect(call?.[0].ca && Redacted.value(call[0].ca)).toBe(pem)
      expect(Redacted.value(call![0].url)).toBe(azure.DATABASE_URL)
      yield* resolve(aws)
      expect(vi.mocked(Postgres.node).mock.calls.at(-1)?.[0].ca).toBeUndefined()
    }),
  )

  it.effect("[SEC-CFG-01] BYMORNING_CONFIG loads the bundled CUI document instead of the default", () =>
    Effect.gen(function* () {
      const input = yield* resolve({ ...aws, BYMORNING_CONFIG: document("bymorning.cui.jsonc") })
      expect(input.settings.configuration?.[0]?.info).toMatchObject({
        plugins: [
          {
            package: "@bymorning/plugin-code-interpreter-agentcore",
            options: { identifier: "test-resource", region: "us-east-1" },
          },
        ],
        code_interpreter: { implementation: "agentcore" },
      })
      expect(() => LayerNode.compile(Application.node(input))).not.toThrow()
    }),
  )

  it.effect("[SEC-CFG-02] BYMORNING_CONFIG fails closed when the file is unreadable", () =>
    Effect.gen(function* () {
      const error = yield* refuse({ ...aws, BYMORNING_CONFIG: document("bymorning.missing.jsonc") })
      expect(String(error)).toContain("Unable to read installation configuration")
    }),
  )

  it.live("[SEC-CFG-03] BYMORNING_CONFIG fails closed when the document is invalid or references an unset name", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => scratch("host-config-"))
      const invalid = path.join(directory, "bymorning.jsonc")
      yield* Effect.promise(() => writeFile(invalid, '{ "plugins": [ broken\n'))
      expect(String(yield* refuse({ ...aws, BYMORNING_CONFIG: invalid }))).toContain(
        "Invalid installation configuration",
      )
      // A document reference the deployment did not set names the variable, not a value.
      const unset = yield* refuse({ ...aws, CODE_INTERPRETER_ID: undefined })
      expect(String(unset)).toContain("CODE_INTERPRETER_ID")
    }),
  )

  it.effect("[SEC-CFG-04] the bundled CUI document loads neither the Share nor the Google plugin", () =>
    Effect.gen(function* () {
      const cui = yield* loadConfiguration(document("bymorning.cui.jsonc"), {
        CODE_INTERPRETER_ID: "ci",
        AWS_REGION: "us-gov-west-1",
      })
      // Tools exist only through loaded Plugins: with the Share and Google
      // plugins absent, the share Tool and the Gmail Tools are unavailable.
      expect(cui.info.plugins).toEqual([
        {
          package: "@bymorning/plugin-code-interpreter-agentcore",
          options: { identifier: "ci", region: "us-gov-west-1" },
        },
      ])
      expect(JSON.stringify(cui.info)).not.toContain("plugin-share")
      expect(JSON.stringify(cui.info)).not.toContain("plugin-google")
    }),
  )

  const kubernetes = "@bymorning/plugin-code-interpreter-kubernetes"
  const digest = `registry.azurecr.us/bymorning-code-interpreter@sha256:${"a".repeat(64)}`
  const unpinned: Array<[string, Record<string, unknown>]> = [
    ["no plugin entry", { plugins: ["@bymorning/plugin-share"] }],
    ["no image", { plugins: [{ package: kubernetes, options: {} }] }],
    ["tag instead of digest", { plugins: [{ package: kubernetes, options: { image: "registry/x:1.0" } }] }],
    ["short digest", { plugins: [{ package: kubernetes, options: { image: "registry/x@sha256:abc" } }] }],
  ]
  it.live.each(unpinned)("selecting the kubernetes Code Interpreter with %s refuses startup", ([, extra]) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => scratch("host-kubernetes-"))
      const file = path.join(directory, "bymorning.jsonc")
      yield* Effect.promise(() =>
        writeFile(file, JSON.stringify({ ...extra, code_interpreter: { implementation: "kubernetes" } })),
      )
      const error = yield* refuse({ ...azure, BYMORNING_CONFIG: file })
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "code_interpreter.image" })
      // The rule applies to every deployment, not only Azure.
      expect(yield* refuse({ ...aws, BYMORNING_CONFIG: file })).toMatchObject({ setting: "code_interpreter.image" })
    }),
  )

  it.live("a digest-pinned kubernetes Code Interpreter resolves", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => scratch("host-kubernetes-"))
      const file = path.join(directory, "bymorning.jsonc")
      yield* Effect.promise(() =>
        writeFile(
          file,
          JSON.stringify({
            plugins: [{ package: kubernetes, options: { image: digest, namespace: "bymorning-sandbox" } }],
            code_interpreter: { implementation: "kubernetes" },
          }),
        ),
      )
      const input = yield* resolve({ ...azure, BYMORNING_CONFIG: file })
      expect(input.settings.configuration?.[0]?.info.code_interpreter).toEqual({ implementation: "kubernetes" })
    }),
  )
})

describe("the development selection", () => {
  it.live("filesystem + local resolves a loopback deployment under BYMORNING_DATA_DIR", () =>
    Effect.gen(function* () {
      const data = yield* Effect.promise(() => scratch("host-dev-"))
      const environment = { BYMORNING_DATA_DIR: data, PORT: "4321" }
      const selected = yield* Dev.selection.pipe(provide(environment))
      expect(selected.defaults).toMatchObject({
        STORAGE_PROVIDER: "filesystem",
        CIPHER_BACKEND: "local",
        HOST: "127.0.0.1",
        APP_ORIGIN: "http://localhost:4321",
        BYMORNING_DATA_DIR: data,
      })
      const connection = { url: Redacted.make("postgresql://unused@localhost/test") }
      const input = yield* resolveWith(environment, { ...selected, database: Effect.succeed(connection) })
      const { settings } = input
      expect(settings.appOrigin.href).toBe("http://localhost:4321/")
      expect(settings.host).toBe("127.0.0.1")
      expect(settings.port).toBe(4321)
      expect(settings.cookiePolicy).toBe(WebCookie.local)
      expect(settings.local).toEqual(Dev.identity)
      expect(settings.allowedEmailDomains).toEqual(["local.test"])
      expect(settings.directory).toBe(data)
      expect(settings.installPackage).toBeUndefined()
      expect(settings.cipher.keyID).toBe("local")
      expect(String(settings.configuration?.[0]?.path)).toBe(document("bymorning.docker.jsonc"))
      expect(settings.configuration?.[0]?.info.code_interpreter).toEqual({ implementation: "docker" })
      const storage = yield* openStorage(input)
      expect(storage.selected).toEqual({ id: "filesystem", name: "Filesystem" })
      // The cipher and cookie keys persist beside the data and are stable across loads.
      const again = yield* resolveWith(environment, {
        ...(yield* Dev.selection.pipe(provide(environment))),
        database: Effect.succeed(connection),
      })
      const generated = yield* settings.cipher.generate
      const unwrapped = yield* again.settings.cipher.unwrap(generated.dataKey, again.settings.cipher.keyID)
      expect(Buffer.from(unwrapped).equals(Buffer.from(generated.key))).toBe(true)
      expect(again.settings.appOrigin.href).toBe(settings.appOrigin.href)
      // Environment wins over defaults.
      const overridden = yield* resolveWith(
        { ...environment, HOST: "0.0.0.0", APP_ORIGIN: "http://127.0.0.1:4321" },
        { ...selected, database: Effect.succeed(connection) },
      )
      expect(overridden.settings.host).toBe("0.0.0.0")
      expect(overridden.settings.appOrigin.hostname).toBe("127.0.0.1")
      expect(() => LayerNode.compile(Application.node(input))).not.toThrow()
    }),
  )

  it.live("only the development selection serves a plain-HTTP loopback origin", () =>
    Effect.gen(function* () {
      const data = yield* Effect.promise(() => scratch("host-dev-"))
      const environment = { BYMORNING_DATA_DIR: data }
      const selected = yield* Dev.selection.pipe(provide(environment))
      const connection = { url: Redacted.make("postgresql://unused@localhost/test") }
      for (const origin of ["http://localhost:3210", "http://127.0.0.1", "http://[::1]:8080"]) {
        const input = yield* resolveWith(
          { ...environment, APP_ORIGIN: origin },
          { ...selected, database: Effect.succeed(connection) },
        )
        expect(input.settings.cookiePolicy).toBe(WebCookie.local)
        expect(input.settings.appOrigin.href).toBe(new URL(origin).href)
      }
      // A non-loopback origin is https-only in development too; https switches to Secure cookies.
      const error = yield* resolveWith(
        { ...environment, APP_ORIGIN: "http://app.example.com" },
        { ...selected, database: Effect.succeed(connection) },
      ).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "APP_ORIGIN" })
      expect(String(error)).toContain("unless loopback")
      const secure = yield* resolveWith(
        { ...environment, APP_ORIGIN: "https://app.example.com" },
        { ...selected, database: Effect.succeed(connection) },
      )
      expect(secure.settings.cookiePolicy).toBe(WebCookie.secure)
    }),
  )

  it.live("the same development environment is refused by the image's selection", () =>
    Effect.gen(function* () {
      const data = yield* Effect.promise(() => scratch("host-dev-"))
      const environment = {
        ...common,
        APP_ORIGIN: "http://localhost:3210",
        STORAGE_PROVIDER: "filesystem",
        CIPHER_BACKEND: "local",
        BYMORNING_DATA_DIR: data,
        BYMORNING_CONFIG: document("bymorning.docker.jsonc"),
      }
      const selected = yield* Dev.selection.pipe(provide(environment))
      const accepted = yield* resolveWith(environment, {
        ...selected,
        database: Effect.succeed({ url: Redacted.make(common.DATABASE_URL) }),
      })
      expect(accepted.settings.cipher.keyID).toBe("local")
      const error = yield* refuse(environment)
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "STORAGE_PROVIDER" })
      expect(String(error)).toContain("s3, azure-blob")
      expect(String(yield* refuse({ ...environment, STORAGE_PROVIDER: "s3" }))).toContain("kms, keyvault")
    }),
  )

  it.live("without DATABASE_URL the development entry migrates a persisted PGlite database", () =>
    Effect.gen(function* () {
      const data = yield* Effect.promise(() => scratch("host-pglite-"))
      yield* Dev.migrate.pipe(provide({ BYMORNING_DATA_DIR: data }))
      // A second run reopens the same directory and applies nothing new.
      yield* Dev.migrate.pipe(provide({ BYMORNING_DATA_DIR: data }))
      const withCA = yield* Dev.selection.pipe(
        provide({ BYMORNING_DATA_DIR: data, DATABASE_CA: "-----BEGIN CERTIFICATE-----" }),
        Effect.flatMap((selected) => selected.database!),
        Effect.flip,
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ BYMORNING_DATA_DIR: data, DATABASE_CA: "x" })),
        ),
      )
      expect(withCA).toMatchObject({ _tag: "Host.ConfigError", setting: "DATABASE_CA" })
    }),
  )
})

describe("the image entry", () => {
  const boot = (environment: Environment) =>
    Effect.gen(function* () {
      const database = yield* TestDatabase.shared
      const url = yield* database.create()
      // The listener is plain HTTP on a loopback port; APP_ORIGIN is the public
      // https origin the load balancer or ingress presents, as in the image.
      const input = yield* resolve({ ...environment, DATABASE_URL: Redacted.value(url), HOST: "127.0.0.1" })
      expect(input.settings.cookiePolicy).toBe(WebCookie.secure)
      // Port 0 asks the OS for a free port; the layer's HttpServer reports it.
      const context = yield* Layer.build(Application.layer(Application.node(input), { ...input.settings, port: 0 }))
      const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
      const response = yield* Effect.promise(() => fetch(new URL("/system/health", origin)))
      expect(response.status).toBe(200)
      return input
    })

  it.live("boots the s3 + kms deployment and answers /system/health", () =>
    Effect.gen(function* () {
      yield* boot(aws)
      expect(S3Client.clients[0]?.sent).toEqual([{ name: "HeadBucketCommand", input: { Bucket: "test-bucket" } }])
      expect(KMSClient.clients).toHaveLength(1)
      expect(ContainerClient.clients).toHaveLength(0)
    }),
  )

  it.live("boots the azure-blob + keyvault deployment and answers /system/health", () =>
    Effect.gen(function* () {
      yield* boot(azure)
      expect(ContainerClient.clients[0]?.calls).toEqual([{ name: "getProperties" }])
      expect(CryptographyClient.clients).toHaveLength(1)
      expect(S3Client.clients).toHaveLength(0)
    }),
  )

  it.live("`migrate` reads only DATABASE_URL, applies the migrations, and constructs no cloud client", () =>
    Effect.gen(function* () {
      const database = yield* TestDatabase.shared
      const url = yield* database.create({ empty: true })
      yield* Index.migrate.pipe(provide({ DATABASE_URL: Redacted.value(url) }))
      // A rerun is a no-op that still succeeds.
      yield* Index.migrate.pipe(provide({ DATABASE_URL: Redacted.value(url) }))
      expect(S3Client.clients).toHaveLength(0)
      expect(KMSClient.clients).toHaveLength(0)
      expect(ContainerClient.clients).toHaveLength(0)
      expect(CryptographyClient.clients).toHaveLength(0)
      expect(DefaultAzureCredential).not.toHaveBeenCalled()
      expect(Index.select("migrate")).toBe(Index.migrate)
      expect(Index.select(undefined)).toBe(Index.program)
      expect(Index.select("serve")).toBe(Index.program)
    }),
  )

  it.live("`migrate` fails opaquely", () =>
    Effect.gen(function* () {
      const error = yield* Index.migrate.pipe(
        provide({ DATABASE_URL: "postgresql://nobody:private-marker@127.0.0.1:1/nothing" }),
        Effect.flip,
      )
      expect(error).toBeInstanceOf(Host.MigrationError)
      expect(error).toMatchObject({ _tag: "Host.MigrationError" })
      expect(Object.keys(error)).toEqual(["_tag"])
      expect(JSON.stringify(error)).not.toContain("private-marker")
      expect(String(error)).not.toContain("private-marker")
    }),
  )

  /** Run `migrate` against one environment and return the captured "Database migration failed" entry. */
  const failedMigration = (environment: Environment) =>
    Effect.gen(function* () {
      const logs = captureLogs()
      const error = yield* Index.migrate.pipe(provide(environment), Effect.provide(logs.layer), Effect.flip)
      expect(error).toBeInstanceOf(Host.MigrationError)
      const failed = logs.entries.filter((entry) => entry.message[0] === "Database migration failed")
      expect(failed).toHaveLength(1)
      const text = JSON.stringify(logs.entries)
      expect(text).not.toContain("private-marker")
      expect(text).not.toContain("nobody")
      return failed[0]!.message[1] as Record<string, string>
    })

  it.live("a failed `migrate` logs the error class: the PostgreSQL SQLSTATE of a rejected password", () =>
    Effect.gen(function* () {
      const database = yield* TestDatabase.shared
      const url = new URL(Redacted.value(yield* database.create({ empty: true })))
      url.username = "nobody"
      url.password = "private-marker"
      const detail = yield* failedMigration({ DATABASE_URL: url.href })
      expect(detail).toEqual({ tag: "SqlError", code: "28P01" })
    }),
  )

  it.live("a failed `migrate` logs the error class: the Node code of an unreachable server", () =>
    Effect.gen(function* () {
      const detail = yield* failedMigration({ DATABASE_URL: "postgresql://nobody:private-marker@127.0.0.1:1/nothing" })
      expect(detail).toEqual({ tag: "SqlError", code: "ECONNREFUSED" })
    }),
  )

  it.live("a failed `migrate` logs the error class: the missing setting", () =>
    Effect.gen(function* () {
      const detail = yield* failedMigration({})
      expect(detail).toEqual({ tag: "ConfigError", setting: "DATABASE_URL" })
    }),
  )
})

describe("the process entry", () => {
  const first = (entries: ReturnType<typeof captureLogs>["entries"]) => {
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry?.level).toBe("Error")
    expect(entry?.message[0]).toBe("Startup failed")
    return entry!.message[1] as Record<string, string>
  }

  it.effect("a Host.ConfigError is logged once as one line naming the setting, then fails the process", () =>
    Effect.gen(function* () {
      const logs = captureLogs()
      const error = yield* Host.main(
        Effect.fail(new Host.ConfigError({ setting: "APP_ORIGIN", reason: "must be an https origin" })),
        undefined,
      ).pipe(Effect.provide(logs.layer), Effect.flip)
      expect(error).toMatchObject({ _tag: "Host.ConfigError", setting: "APP_ORIGIN" })
      const detail = first(logs.entries)
      expect(detail).toEqual({ tag: "Host.ConfigError", error: "APP_ORIGIN: must be an https origin" })
    }),
  )

  it.effect("an Effect ConfigError collapses its multi-line message onto one line naming the variable", () =>
    Effect.gen(function* () {
      const logs = captureLogs()
      yield* Host.main(Config.redacted("DATABASE_URL"), "migrate").pipe(
        provide({}),
        Effect.provide(logs.layer),
        Effect.flip,
      )
      const detail = first(logs.entries)
      expect(detail.tag).toBe("ConfigError")
      expect(detail.error).toContain("DATABASE_URL")
      expect(detail.error).not.toContain("\n")
      expect(JSON.stringify(detail)).not.toContain("\\n")
    }),
  )

  it.effect("a defect keeps its pretty cause; interruption is not reported", () =>
    Effect.gen(function* () {
      const logs = captureLogs()
      yield* Host.main(Effect.die(new Error("boom")), undefined).pipe(Effect.provide(logs.layer), Effect.exit)
      const detail = first(logs.entries)
      expect(detail).toMatchObject({ tag: "Error", error: "boom" })
      expect(detail.cause).toContain("boom")
      const quiet = captureLogs()
      const exit = yield* Host.main(Effect.interrupt, undefined).pipe(Effect.provide(quiet.layer), Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect(Cause.hasInterruptsOnly((exit as Extract<typeof exit, { _tag: "Failure" }>).cause)).toBe(true)
      expect(quiet.entries).toHaveLength(0)
    }),
  )
})
