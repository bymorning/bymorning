import { createHash, createPublicKey, createVerify, type JsonWebKey } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { start, type Fixture } from "./oidc-idp.js"

const verifier = "a-very-long-pkce-verifier-that-is-valid-and-over-forty-three-characters"
const challenge = createHash("sha256").update(verifier).digest("base64url")

const token = async (fixture: Fixture, code: string, extra: Record<string, string> = {}, basic = true) =>
  fetch(new URL("/token", fixture.issuer), {
    method: "POST",
    headers: basic ? { authorization: `Basic ${Buffer.from(`${fixture.clientID}:${fixture.clientSecret}`).toString("base64")}` } : undefined,
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: "http://app.test/callback", ...extra }),
  })

describe("OIDC identity-provider fixture", () => {
  let fixture: Fixture | undefined
  afterEach(async () => { await fixture?.close() })

  it("runs a signed PKCE authorization-code flow", async () => {
    fixture = await start()
    const discovery = await (await fetch(new URL("/.well-known/openid-configuration", fixture.issuer))).json() as Record<string, string>
    expect(discovery.issuer).toBe(fixture.issuer.href)
    expect(discovery.authorization_endpoint).toBe(new URL("/authorize", fixture.issuer).href)
    expect(discovery.token_endpoint).toBe(new URL("/token", fixture.issuer).href)

    const authorizationEndpoint = discovery.authorization_endpoint
    if (!authorizationEndpoint) throw new Error("Discovery omitted authorization endpoint")
    const authorize = new URL(authorizationEndpoint)
    authorize.search = new URLSearchParams({ response_type: "code", client_id: fixture.clientID, redirect_uri: "http://app.test/callback", state: "state", nonce: "nonce", code_challenge: challenge, code_challenge_method: "S256" }).toString()
    const issued = await fixture.authorize(authorize, { sub: "person", email: "person@example.test" })
    const response = await token(fixture, issued.code)
    expect(response.ok).toBe(true)
    const result = await response.json() as { id_token: string }
    const [header, payload, signature] = result.id_token.split(".")
    expect(header).toBeTruthy(); expect(payload).toBeTruthy(); expect(signature).toBeTruthy()
    const jwks = await (await fetch(new URL("/jwks", fixture.issuer))).json() as { keys: JsonWebKey[] }
    const verify = createVerify("RSA-SHA256"); verify.update(`${header}.${payload}`); verify.end()
    expect(verify.verify(createPublicKey({ key: jwks.keys[0]!, format: "jwk" }), Buffer.from(signature!, "base64url"))).toBe(true)
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({ sub: "person", nonce: "nonce" })
  })

  it("rejects an incorrect verifier and reused code", async () => {
    fixture = await start()
    const issue = async () => fixture!.authorize(new URL(`http://idp.test/authorize?response_type=code&client_id=${fixture!.clientID}&redirect_uri=http%3A%2F%2Fapp.test%2Fcallback&code_challenge=${challenge}&code_challenge_method=S256`), { sub: "person" })
    const wrong = await issue()
    expect((await token(fixture, wrong.code, { code_verifier: "wrong" })).status).toBe(400)
    const reused = await issue()
    expect((await token(fixture, reused.code)).status).toBe(200)
    expect((await token(fixture, reused.code)).status).toBe(400)
  })

  it("rejects Basic authentication when only client-secret-post is advertised", async () => {
    fixture = await start({ tokenAuthMethods: ["client_secret_post"] })
    const issued = await fixture.authorize(new URL(`http://idp.test/authorize?response_type=code&client_id=${fixture.clientID}&redirect_uri=http%3A%2F%2Fapp.test%2Fcallback&code_challenge=${challenge}&code_challenge_method=S256`), { sub: "person" })
    expect((await token(fixture, issued.code)).status).toBe(401)
  })
})
