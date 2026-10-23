import { Usage } from "@bymorning/core/usage"
import { AccountActor } from "@bymorning/schema/actor"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { Days } from "@bymorning/schema/usage"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import type { TestApp } from "../src/application.js"
import { Bedrock } from "../src/scenario/bedrock.js"

/** A user access token from the real OAuth grant flow, approved by the logged-in member. */
const userToken = (app: TestApp.Interface, workspaceID: Workspace.ID) =>
  Effect.tryPromise(async () => {
    const redirect = "http://127.0.0.1/callback"
    const registration = await fetch(new URL("/oauth/register", app.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "Usage attribution fixture" }),
    })
    assert.equal(registration.status, 201)
    // @effect-diagnostics-next-line schemaSyncInEffect:off
    const { client_id } = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(
      await registration.json(),
    )
    const verifier = randomBytes(32).toString("base64url")
    const authorize = new URL("/oauth/authorize", app.origin)
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirect,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString()
    const authorization = await fetch(authorize, { redirect: "manual" })
    assert.equal(authorization.status, 302)
    const location = authorization.headers.get("location")
    assert.ok(location)
    const requestID = new URL(location).searchParams.get("request")
    assert.ok(requestID)
    const approval = await app.client["api.oauth"].approve({
      requestID: OAuthAuthorization.ID.make(requestID),
      workspaceID,
    })
    const code = new URL(approval.url).searchParams.get("code")
    assert.ok(code)
    const exchange = await fetch(new URL("/oauth/token", app.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id,
        redirect_uri: redirect,
      }),
    })
    assert.equal(exchange.status, 200)
    // @effect-diagnostics-next-line schemaSyncInEffect:off
    return Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }))(await exchange.json()).access_token
  })

const converse = (app: TestApp.Interface, headers: Record<string, string>) =>
  Effect.tryPromise(() =>
    fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: Bedrock.model.converse, messages: [{ role: "user", content: "hello" }] }),
    }),
  )

test("[SEC-USAGE-01] a Service Account Key invocation is attributed to its Service Account", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, upstream, owner, headers } = yield* Bedrock.make()
        const workspaceID = owner.properties.workspaceID
        const serviceAccount = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.create({ name: "Attribution fixture" }),
        )
        const apiKey = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.key.create({ id: serviceAccount.id, name: "Attribution key" }),
        )
        const paid = yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })

        const completion = yield* converse(app, {
          authorization: `Bearer ${apiKey.secret}`,
          "content-type": "application/json",
        })
        expect(completion.status).toBe(200)
        yield* paid.settled

        const records = yield* app.workspace(
          {
            account: new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } }),
            workspaceID,
          },
          Usage.Service.use((usage) => usage.records()),
        )
        const invocation = records.data.find((record) => record.source === "inference")
        expect(invocation).toBeDefined()
        expect(invocation?.principal).toEqual({ type: "service_account", serviceAccountID: serviceAccount.id })
      }),
    ),
    { signal },
  )
}, 120_000)

test("[SEC-USAGE-02] a user Token invocation is attributed to that User and joins their overview", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, upstream, owner } = yield* Bedrock.make()
        const workspaceID = owner.properties.workspaceID
        const token = yield* userToken(app, workspaceID)
        const paid = yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })

        const completion = yield* converse(app, {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        })
        expect(completion.status).toBe(200)
        yield* paid.settled

        yield* app.workspace(
          {
            account: new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } }),
            workspaceID,
          },
          Effect.gen(function* () {
            const usage = yield* Usage.Service
            const records = yield* usage.records()
            const invocation = records.data.find((record) => record.source === "inference")
            expect(invocation).toBeDefined()
            expect(invocation?.principal).toEqual({ type: "user", userID: owner.properties.userID })

            // The attributed Gateway row appears in the per-user overview.
            const overview = yield* usage.overview({ days: Days.make(7) })
            const entry = overview.users.find((user) => user.userID === owner.properties.userID)
            expect(entry?.usage.invocations).toBeGreaterThanOrEqual(1)
          }),
        )
      }),
    ),
    { signal },
  )
}, 120_000)
