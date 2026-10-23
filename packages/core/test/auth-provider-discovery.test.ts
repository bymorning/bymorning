import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Effect, Schema } from "effect"
import { createServer, type Server } from "node:http"
import { afterEach, expect, test } from "vitest"
import { admit } from "../src/auth-provider/discovery.js"

let server: Server | undefined

afterEach(async () => {
  const current = server
  server = undefined
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()))
})

/** Serve one discovery response at `<issuer>/.well-known/openid-configuration`. */
const serve = async (respond: (issuer: string) => { readonly status: number; readonly body?: unknown }) => {
  let issuer = ""
  server = createServer((request, response) => {
    if (request.url !== "/tenant/v2.0/.well-known/openid-configuration") {
      response.writeHead(404).end()
      return
    }
    const reply = respond(issuer)
    response.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body ?? {}))
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("no port")
  issuer = `http://127.0.0.1:${address.port}/tenant/v2.0`
  return { issuer, origin: `http://127.0.0.1:${address.port}` }
}

const metadata = (issuer: string, overrides: Record<string, unknown> = {}) => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
  ...overrides,
})

const failure = (issuer: string) =>
  Effect.runPromise(
    admit(Schema.decodeUnknownSync(AuthProvider.Issuer)(issuer)).pipe(
      Effect.flip,
      Effect.map((error) => ({ reason: error.reason, message: error.message })),
    ),
  )

test("admits a compatible issuer", async () => {
  const { issuer } = await serve((issuer) => ({ status: 200, body: metadata(issuer) }))
  await expect(Effect.runPromise(admit(Schema.decodeUnknownSync(AuthProvider.Issuer)(issuer)))).resolves.toBeUndefined()
})

test("names the unreachable issuer origin and the Gateway egress remedy", async () => {
  const { issuer, origin } = await serve(() => ({ status: 200 }))
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  expect(await failure(issuer)).toEqual({
    reason: "unreachable",
    message: `ByMorning could not reach the identity provider at ${origin}. Check that the Gateway has outbound HTTPS access to it.`,
  })
})

test("reports an issuer mismatch without echoing the provider's issuer", async () => {
  const { issuer, origin } = await serve(() => ({ status: 200, body: metadata("https://wrong.example/tenant") }))
  const result = await failure(issuer)
  expect(result).toEqual({
    reason: "issuer",
    message: `The identity provider's discovery document at ${origin} did not match the issuer. Check the issuer URL.`,
  })
  expect(result.message).not.toContain("wrong.example")
})

test("reports a missing or invalid discovery document as an issuer problem", async () => {
  const { issuer, origin } = await serve(() => ({ status: 404, body: { error: "secret provider detail" } }))
  const result = await failure(issuer)
  expect(result).toEqual({
    reason: "issuer",
    message: `The identity provider at ${origin} did not return a valid discovery document for this issuer. Check the issuer URL.`,
  })
  expect(result.message).not.toContain("secret provider detail")
})

test.each([
  ["endpoint", { jwks_uri: undefined }, "does not list an authorization, token, and JWKS endpoint."],
  ["grant", { response_types_supported: ["token"] }, "does not support the authorization code flow."],
  ["pkce", { code_challenge_methods_supported: ["plain"] }, "does not support PKCE with S256."],
  [
    "client-auth",
    { token_endpoint_auth_methods_supported: ["private_key_jwt"] },
    "does not accept a client secret (client_secret_basic or client_secret_post).",
  ],
] as const)("reports %s incompatibility with the issuer origin", async (reason, overrides, suffix) => {
  const { issuer, origin } = await serve((issuer) => ({ status: 200, body: metadata(issuer, overrides) }))
  const result = await failure(issuer)
  expect(result.reason).toBe(reason)
  expect(result.message).toContain(origin)
  expect(result.message.endsWith(suffix)).toBe(true)
})
