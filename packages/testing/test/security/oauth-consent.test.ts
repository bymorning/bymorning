/**
 * OAuth consent for MCP clients (OAuth 2.0 Security BCP, phishing of dynamically registered clients). A client
 * names itself at registration, so its name proves nothing; the consent request therefore also reports where an
 * approval will be sent, as scheme and host only. Each test carries a stable [SEC-OAUTH-nn] identifier for
 * compliance reports.
 */
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { Effect } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"

test("[SEC-OAUTH-01] the consent request reports where an approval is sent, as origins only, whatever the client calls itself", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      const redirects = [
        "http://127.0.0.1:33418/callback",
        // Path and query are attacker-controlled detail; only the origin may be shown.
        "https://attacker.example/steal?token=secret#ignored-by-registration",
        "https://attacker.example/other",
        "cursor://anysphere.cursor-retrieve-mcp/oauth/user-x/callback",
      ]
      const requested = yield* Effect.tryPromise(async () => {
        // A fragment is refused at registration, so register the valid forms and authorize with one of them.
        const valid = redirects.filter((uri) => !uri.includes("#"))
        const rejected = await fetch(new URL("/oauth/register", app.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect_uris: [redirects[1]], client_name: "Claude Code" }),
        })
        expect(rejected.status).toBe(400)
        const registration = await fetch(new URL("/oauth/register", app.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            redirect_uris: [...valid, "https://attacker.example/steal?token=secret"],
            client_name: "Claude Code",
          }),
        })
        expect(registration.status).toBe(201)
        const { client_id } = (await registration.json()) as { client_id: string }
        const authorize = new URL("/oauth/authorize", app.origin)
        authorize.search = new URLSearchParams({
          response_type: "code",
          client_id,
          redirect_uri: valid[0]!,
          code_challenge: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url"),
          code_challenge_method: "S256",
        }).toString()
        const authorization = await fetch(authorize, { redirect: "manual" })
        expect(authorization.status).toBe(302)
        const requestID = new URL(authorization.headers.get("location")!).searchParams.get("request")
        expect(requestID).not.toBeNull()
        return app.client["api.oauth"].request.get({ id: OAuthAuthorization.ID.make(requestID!) })
      })

      // The self-declared name is passed through unchanged: the page must not treat it as an identity.
      expect(requested.clientName).toBe("Claude Code")
      expect(requested.redirectOrigins).toEqual([
        "cursor://anysphere.cursor-retrieve-mcp",
        "http://127.0.0.1:33418",
        "https://attacker.example",
      ])
      expect(JSON.stringify(requested)).not.toContain("secret")
      expect(JSON.stringify(requested)).not.toContain("/steal")
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)
