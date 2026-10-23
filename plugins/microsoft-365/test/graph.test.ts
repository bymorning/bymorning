import { describe, expect, it } from "vitest"
import { microsoft365, registerIntegration } from "../src/graph.js"

const clientAnswer = { client_id: "fixture-client", client_secret: "fixture-secret" }

function oauthFixture(wait: Promise<{ code: string } | { error: string }>) {
  let method: any
  const context = {
    integration: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          update: (id: string, update: (integration: any) => void) => update({ id }),
          method: {
            update: (value: unknown) => {
              method = value
            },
          },
        })
        return { dispose: async () => undefined }
      },
      oauth: {
        callback: {
          register: async () => ({
            state: "host-state",
            callbackURI: "https://app.example/auth/integration/callback",
            expiresAt: 123,
            wait,
          }),
        },
      },
    },
  } as any
  return { context, method: async () => (await registerIntegration(context), method) }
}

describe("Microsoft 365 OAuth Integration", () => {
  it("registers the shared member-only Integration", async () => {
    const seen: any = {}
    await registerIntegration({
      integration: {
        transform: async (callback: any) => {
          callback({
            update: (id: string, update: (integration: any) => void) => {
              seen.integration = { id }
              update(seen.integration)
            },
            method: {
              update: (value: any) => {
                seen.method = value
              },
            },
          })
          return { dispose: async () => undefined }
        },
      },
    } as any)
    expect(seen.integration).toMatchObject({ id: microsoft365.integrationID, connectionPolicy: "member-only" })
    expect(seen.method.method).toMatchObject({ id: microsoft365.methodID, type: "oauth" })
    expect(seen.method.method.client).toContainEqual(expect.objectContaining({ key: "client_secret", secret: true }))
  })

  it("authorizes without leaking the client secret and keeps safe metadata", async () => {
    const requests: Array<{ url: string; body: string }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input)
      requests.push({ url, body: String(init?.body ?? "") })
      if (url.includes("/oauth2/v2.0/token")) {
        return Response.json({ access_token: "live-access", expires_in: 3600, refresh_token: "live-refresh" })
      }
      return Response.json({ id: "member-id", mail: "person@example.com", userPrincipalName: "person@example.com" })
    }) as typeof fetch
    try {
      const test = oauthFixture(Promise.resolve({ code: "authorization-code" }))
      const method = await test.method()
      const authorization = await method.authorize({}, clientAnswer)
      expect(authorization.mode).toBe("auto")
      const url = new URL(authorization.url)
      expect(url.searchParams.get("state")).toBe("host-state")
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/auth/integration/callback")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("scope")?.split(" ")).toEqual([...microsoft365.scopes])
      expect(authorization.url).not.toContain("fixture-secret")
      const credential = await authorization.callback
      expect(credential).toMatchObject({
        type: "oauth",
        access: "live-access",
        refresh: "live-refresh",
        metadata: { id: "member-id", mail: "person@example.com" },
      })
      expect(requests[0]?.body).toContain("client_secret=fixture-secret")
      expect(JSON.stringify({ authorization, metadata: credential.metadata })).not.toMatch(
        /fixture-secret|live-access|live-refresh/,
      )
    } finally {
      globalThis.fetch = original
    }
  })

  it("requires a refresh token and sanitizes provider failures", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => Response.json({ access_token: "live-access", expires_in: 3600 })) as typeof fetch
    try {
      const test = oauthFixture(Promise.resolve({ code: "authorization-code" }))
      const method = await test.method()
      const authorization = await method.authorize({}, clientAnswer)
      await expect(authorization.callback).rejects.toThrow("Microsoft did not return a refresh token")
    } finally {
      globalThis.fetch = original
    }
  })

  it("refreshes with current client configuration and preserves safe metadata", async () => {
    const requests: Array<{ body: string }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: any, init?: any) => {
      requests.push({ body: String(init?.body ?? "") })
      return Response.json({ access_token: "rotated-access", expires_in: 3600 })
    }) as typeof fetch
    try {
      const test = oauthFixture(new Promise<{ code: string }>(() => {}))
      const method = await test.method()
      const refreshed = await method.refresh(
        {
          type: "oauth",
          methodID: "oauth",
          access: "stale-access",
          refresh: "stale-refresh",
          expires: 0,
          metadata: { id: "member-id", mail: "person@example.com", clientSecret: "legacy-secret" },
        },
        { client_id: "replacement-client", client_secret: "replacement-secret" },
      )
      expect(refreshed).toMatchObject({ access: "rotated-access", refresh: "stale-refresh" })
      expect(refreshed.metadata).toEqual({ id: "member-id", mail: "person@example.com" })
      expect(requests[0]?.body).toContain("client_secret=replacement-secret")
      expect(JSON.stringify({ metadata: refreshed.metadata })).not.toMatch(
        /replacement-secret|rotated-access|stale-refresh/,
      )
      await expect(method.refresh({ ...refreshed, refresh: "" }, clientAnswer)).rejects.toThrow(
        "Reconnect Microsoft 365",
      )
      await expect(method.authorize({}, {})).rejects.toThrow("OAuth client configuration is incomplete")
    } finally {
      globalThis.fetch = original
    }
  })
})
