import { describe, expect, it } from "@effect/vitest"
import { Credential, Integration, type OpenAPI } from "@bymorning/plugin/effect"
import type {
  IntegrationEditor,
  IntegrationMethodRegistration,
  IntegrationOAuthCallbackResponse,
} from "@bymorning/plugin/effect/integration"
import type { Registration } from "@bymorning/plugin/effect/registration"
import { Effect, Option } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { googleGmail } from "../src/google.js"
import { register } from "../src/gmail.js"

const dispose = Effect.void

function fixture(
  http: HttpClient.HttpClient,
  callback: Effect.Effect<IntegrationOAuthCallbackResponse> = Effect.never,
) {
  let integration: NonNullable<ReturnType<IntegrationEditor["get"]>> | undefined
  let method: IntegrationMethodRegistration | undefined
  let openapi: OpenAPI.Options | undefined
  const editor = {
    list: () => (integration === undefined ? [] : [integration]),
    get: (id) => (integration?.id === id ? integration : undefined),
    update: (id, update) => {
      integration = { id, name: id }
      update(integration)
    },
    remove: () => {
      integration = undefined
    },
    method: {
      list: () => [],
      update: (value) => {
        method = value
      },
      remove: () => {},
    },
  } satisfies IntegrationEditor
  const context = {
    integration: {
      transform: (transform) => Effect.sync(() => transform(editor)).pipe(Effect.as({ dispose })),
      oauth: {
        callback: {
          register: () =>
            Effect.succeed({
              state: "host-state",
              callbackURI: "https://app.example/auth/integration/callback",
              expiresAt: 123,
              wait: callback,
            }),
        },
      },
    },
    tool: {
      openapi: (options) =>
        Effect.sync(() => {
          openapi = options
          return { operationNames: [], skipped: [], dispose } satisfies OpenAPI.Summary & Registration
        }),
    },
  } satisfies Parameters<typeof register>[0]
  return { context, integration: () => integration, method: () => method, openapi: () => openapi, http }
}

describe("Google Gmail package plugin", () => {
  it.effect("registers the member OAuth Integration and six host-owned OpenAPI Tools", () =>
    Effect.gen(function* () {
      const test = fixture(HttpClient.make(() => Effect.die("OAuth HTTP is unused")))
      yield* register(test.context, test.http)

      expect(test.integration()).toEqual({
        id: googleGmail.integrationID,
        name: "Google Gmail",
        connectionPolicy: "member-only",
      })
      expect(test.method()?.method).toMatchObject({
        id: googleGmail.methodID,
        type: "oauth",
        label: "Google OAuth web app",
        client: [
          { key: "client_id", title: "OAuth client ID", required: true },
          { key: "client_secret", title: "OAuth client secret", required: true, secret: true },
        ],
      })
      expect(test.openapi()).toMatchObject({
        namespace: "gmail",
        permissionPrefix: "gmail",
        baseURL: googleGmail.apiURL,
        expectedOrigin: googleGmail.apiURL,
        authentication: {
          type: "integration",
          integrationID: googleGmail.integrationID,
          schemes: { googleOAuth: { type: "bearer" } },
        },
      })
      expect(Object.keys(test.openapi()?.spec.paths ?? {}).sort()).toEqual([
        "/gmail/v1/users/{userId}/editors",
        "/gmail/v1/users/{userId}/labels",
        "/gmail/v1/users/{userId}/messages",
        "/gmail/v1/users/{userId}/messages/{id}",
        "/gmail/v1/users/{userId}/threads/{id}",
      ])
      expect(test.openapi()?.spec.paths).toMatchObject({
        "/gmail/v1/users/{userId}/messages": { get: { operationId: "messages.search" } },
        "/gmail/v1/users/{userId}/messages/{id}": { get: { operationId: "messages.get" } },
        "/gmail/v1/users/{userId}/threads/{id}": { get: { operationId: "threads.get" } },
        "/gmail/v1/users/{userId}/labels": { get: { operationId: "labels.list" } },
        "/gmail/v1/users/{userId}/editors": {
          get: { operationId: "editors.list" },
          post: { operationId: "editors.create" },
        },
      })
      expect(test.openapi()?.spec.security).toEqual([{ googleOAuth: googleGmail.toolScopes }])
    }),
  )

  it.effect("uses current OAuth client configuration without retaining its secrets", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly authorization?: string; readonly body: string }> = []
      let tokenRequests = 0
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          const url = HttpClientRequest.toUrl(request).pipe(Option.getOrThrow)
          const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
          requests.push({
            url: url.href,
            authorization: Headers.get(request.headers, "authorization").pipe(Option.getOrUndefined),
            body,
          })
          if (url.href === googleGmail.tokenURL) {
            tokenRequests++
            if (tokenRequests === 3)
              return HttpClientResponse.fromWeb(request, new Response("sensitive-provider-body", { status: 500 }))
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                tokenRequests === 1
                  ? { access_token: "access-1", expires_in: 3600, refresh_token: "refresh-1" }
                  : { access_token: "access-2", expires_in: 3600 },
              ),
            )
          }
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ sub: "google-subject", email: "person@example.com" }),
          )
        }),
      )
      const test = fixture(http, Effect.succeed({ code: "authorization-code" }))
      yield* register(test.context, http)
      const method = test.method()
      if (method === undefined || !("authorize" in method) || method.refresh === undefined)
        return yield* Effect.die("OAuth method missing")

      const authorization = yield* method.authorize(
        {},
        { client_id: "current-client", client_secret: "current-secret" },
      )
      if (authorization.mode !== "auto") return yield* Effect.die("Automatic callback missing")
      const url = new URL(authorization.url)
      const credential = yield* authorization.callback
      const refreshed = yield* method.refresh(
        {
          ...credential,
          metadata: {
            sub: "google-subject",
            subject: "legacy-subject",
            email: "person@example.com",
            clientID: "legacy-client",
            clientSecret: "legacy-secret",
            unrelated: "remove-me",
          },
        },
        { client_id: "replacement-client", client_secret: "replacement-secret" },
      )

      expect(url.searchParams.get("state")).toBe("host-state")
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/auth/integration/callback")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("access_type")).toBe("offline")
      expect(url.searchParams.get("prompt")).toBe("consent")
      expect(url.searchParams.get("scope")?.split(" ")).toEqual(googleGmail.authorizationScopes)
      expect(authorization.url).not.toContain("current-secret")
      expect(credential.metadata).toEqual({ sub: "google-subject", email: "person@example.com" })
      expect(refreshed).toMatchObject({ access: "access-2", refresh: "refresh-1" })
      expect(refreshed.metadata).toEqual({ sub: "google-subject", email: "person@example.com" })
      expect(requests).toHaveLength(3)
      expect(requests[0]?.body).toContain("client_secret=current-secret")
      expect(requests[2]?.body).toContain("client_secret=replacement-secret")
      expect(requests[1]?.authorization).toBe("Bearer access-1")
      expect(
        JSON.stringify({ authorization, credential: credential.metadata, refreshed: refreshed.metadata }),
      ).not.toMatch(/current-secret|replacement-secret|access-1|access-2|refresh-1/)
      const missing = yield* method.authorize({}, {}).pipe(Effect.flip)
      expect(JSON.stringify(missing)).not.toMatch(/client_id|client_secret/)
      const failed = yield* method
        .refresh(refreshed, { client_id: "replacement-client", client_secret: "replacement-secret" })
        .pipe(Effect.flip)
      expect(JSON.stringify(failed)).not.toMatch(
        /client_secret|current-secret|replacement-secret|access-1|access-2|refresh-1|sensitive-provider-body/,
      )
    }),
  )
})
