import { AuthProvider } from "@bymorning/core/auth-provider"
import { Audit } from "@bymorning/core/audit"
import { Cipher } from "@bymorning/core/cipher"
import { Database } from "@bymorning/core/database"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Logger, ManagedRuntime, Redacted, Schema } from "effect"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { start, type Fixture } from "../test/oidc-idp.js"
import { postgres } from "../test/postgres.js"

const database = postgres()
const cipherBackend = Effect.runSync(
  Cipher.localBackend(Redacted.make(Buffer.alloc(32, 23).toString("base64url"))).pipe(Effect.provide(NodeCrypto.layer)),
)
const layer = LayerNode.compile(LayerNode.group([AuthProvider.node, Database.node]), {
  replacements: [
    Database.node.replace(database),
    Audit.node.replace(Audit.makeNode({ database: Database.node })),
    Cipher.node.replace(Cipher.configured(cipherBackend)),
  ],
})

let runtime: ManagedRuntime.ManagedRuntime<AuthProvider.Service, unknown>
let fixture: Fixture
let directory: string
const tokenFile = () => join(directory, "setup-token")

const run = <A, E>(effect: Effect.Effect<A, E, AuthProvider.Service>) => runtime.runPromise(effect)

/** Capture the log messages emitted by one effect; nothing may contain the token. */
const captureLogs = () => {
  const messages: string[] = []
  const logger = Logger.make((input) => {
    messages.push(
      (Array.isArray(input.message) ? input.message : [input.message])
        .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
        .join(" "),
    )
  })
  return { messages, provide: Logger.layer([logger]) }
}

beforeAll(async () => {
  fixture = await start()
  runtime = ManagedRuntime.make(layer)
  directory = await mkdtemp(join(tmpdir(), "bymorning-setup-token-test-"))
}, 120_000)

afterAll(async () => {
  await runtime.dispose()
  await fixture.close()
  await rm(directory, { recursive: true, force: true })
})

describe("Auth Provider setup token", () => {
  it("[SEC-SETUP-01] reveals the generated token through an owner-read-only file and never logs it", async () => {
    const logs = captureLogs()
    await run(
      AuthProvider.Service.use((providers) => providers.init({ tokenFile: tokenFile() })).pipe(
        Effect.provide(logs.provide),
      ),
    )

    const revealed = (await readFile(tokenFile(), "utf8")).trim()
    expect(revealed.length).toBeGreaterThan(32)
    const mode = (await stat(tokenFile())).mode & 0o777
    expect(mode.toString(8)).toBe("600")
    // The log reports where the token is, never the token itself.
    expect(logs.messages.some((message) => message.includes(tokenFile()))).toBe(true)
    expect(logs.messages.some((message) => message.includes(revealed))).toBe(false)

    // The revealed token proves setup authority; a wrong token does not.
    const listed = await run(AuthProvider.Service.use((providers) => providers.inspect(Redacted.make(revealed))))
    expect(listed).toEqual([])
    const refused = await run(
      AuthProvider.Service.use((providers) => providers.inspect(Redacted.make("not-the-token"))).pipe(Effect.flip),
    )
    expect(refused._tag).toBe("AuthProvider.TokenError")

    // A restart keeps the same token and reveals it again.
    const again = await run(
      AuthProvider.Service.use((providers) => providers.init({ tokenFile: tokenFile() })),
    )
    expect(again).toBeUndefined()
    expect((await readFile(tokenFile(), "utf8")).trim()).toBe(revealed)
  }, 120_000)

  it("[SEC-SETUP-02] accepts the operator-supplied token without writing or logging it", async () => {
    const operatorToken = `operator-${crypto.randomUUID()}`
    const logs = captureLogs()
    await run(
      AuthProvider.Service.use((providers) =>
        providers.init({ token: Redacted.make(operatorToken), tokenFile: tokenFile() }),
      ).pipe(Effect.provide(logs.provide)),
    )
    expect(logs.messages.some((message) => message.includes("operator-configured setup token"))).toBe(true)
    expect(logs.messages.some((message) => message.includes(operatorToken))).toBe(false)
    await expect(stat(tokenFile())).rejects.toMatchObject({ code: "ENOENT" })

    const listed = await run(AuthProvider.Service.use((providers) => providers.inspect(Redacted.make(operatorToken))))
    expect(Array.isArray(listed)).toBe(true)

    // The operator token also satisfies the guarded setup operation's proof.
    const wrong = await run(
      AuthProvider.Service.use((providers) => providers.inspect(Redacted.make("wrong-token"))).pipe(Effect.flip),
    )
    expect(wrong._tag).toBe("AuthProvider.TokenError")
  }, 120_000)

  it("[SEC-SETUP-03] removes the revealed token once an Auth Provider exists", async () => {
    const logs = captureLogs()
    await run(
      AuthProvider.Service.use((providers) => providers.init({ tokenFile: tokenFile() })).pipe(
        Effect.provide(logs.provide),
      ),
    )
    expect((await stat(tokenFile())).mode & 0o777).toBe(0o600)

    await run(
      AuthProvider.Service.use((providers) =>
        providers.create(
          Schema.decodeUnknownSync(AuthProvider.Create)({
            id: AuthProvider.ID.create(),
            displayName: "Fixture IdP",
            kind: "custom",
            issuer: fixture.issuer.href,
            clientID: fixture.clientID,
            clientSecret: fixture.clientSecret,
            domains: ["example.test"],
          }),
        ),
      ),
    )

    await run(AuthProvider.Service.use((providers) => providers.init({ tokenFile: tokenFile() })))
    await expect(stat(tokenFile())).rejects.toMatchObject({ code: "ENOENT" })
    expect(logs.messages.some((message) => message.includes("setup pending"))).toBe(true)
  }, 120_000)
})
