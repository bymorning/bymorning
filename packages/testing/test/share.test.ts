import { expect, test } from "vitest"
import { Effect } from "effect"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { ShareScenario } from "../src/scenario/share.js"

const unknownToken = "00000000-0000-4000-8000-000000000000"

const publicShare = (app: TestApp.Interface, workspaceID: string, token: string) =>
  Effect.tryPromise(() => fetch(new URL(`/api/public/share/${workspaceID}/${token}`, app.origin)))

const notFound = (workspaceID: string, token: string) => ({
  _tag: "Share.NotFoundError",
  workspaceID,
  token,
  message: "Share not found",
})

test("share publishes a cookie-less public view and unknown tokens stay 404", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({ plugins: ["@bymorning/plugin-share"] })
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID
        const missing = yield* publicShare(app, workspaceID, unknownToken)
        expect(missing.status).toBe(404)
        const missingBody = yield* Effect.tryPromise(() => missing.json())
        expect(missingBody).toMatchObject(notFound(workspaceID, unknownToken))
        expect(JSON.stringify(missingBody)).not.toContain(data.session.id)

        const script = yield* ShareScenario.script(app, data, "share")
        yield* ShareScenario.complete(app, data, script)
        yield* app.llm.settled(data.session.id, "title")
        expect(script.grant.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
        expect(script.grant.url).toBe(`/s/${workspaceID}/${script.grant.token}`)
        expect(script.answer).toContain(script.grant.url)

        const published = yield* publicShare(app, workspaceID, script.grant.token)
        expect(published.status).toBe(200)
        const body = yield* Effect.tryPromise(() => published.json())
        expect(body).toMatchObject({ title: script.title, token: script.grant.token, workspaceID })
        expect(JSON.stringify(body)).toContain(script.prompt)
        expect(JSON.stringify(body)).toContain(script.answer)

        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("unshare revokes the public view", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({ plugins: ["@bymorning/plugin-share"] })
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID
        const shared = yield* ShareScenario.script(app, data, "share")
        yield* ShareScenario.complete(app, data, shared)
        const live = yield* publicShare(app, workspaceID, shared.grant.token)
        expect(live.status).toBe(200)

        const revoked = yield* ShareScenario.script(app, data, "unshare")
        yield* ShareScenario.complete(app, data, revoked)
        const missing = yield* publicShare(app, workspaceID, shared.grant.token)
        expect(missing.status).toBe(404)
        const missingBody = yield* Effect.tryPromise(() => missing.json())
        expect(missingBody).toMatchObject(notFound(workspaceID, shared.grant.token))
        expect(JSON.stringify(missingBody)).not.toContain(data.session.id)
        expect(JSON.stringify(missingBody)).not.toContain(shared.prompt)

        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})
