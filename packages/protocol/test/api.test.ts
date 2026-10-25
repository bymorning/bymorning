import { HttpApi, HttpApiMiddleware } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { makeApi } from "../src/api.js"
import { AccountMiddleware } from "../src/middleware/account-middleware.js"

class GenericWorkspaceMiddleware extends HttpApiMiddleware.Service<GenericWorkspaceMiddleware, { provides: never }>()(
  "test/GenericWorkspaceMiddleware",
) {}

class PersistedSessionMiddleware extends HttpApiMiddleware.Service<PersistedSessionMiddleware, { provides: never }>()(
  "test/PersistedSessionMiddleware",
) {}

describe("portable protocol", () => {
  test("routes workspace and persisted-session middleware in endpoint order", () => {
    const routes: Array<string> = []
    HttpApi.reflect(makeApi(AccountMiddleware, GenericWorkspaceMiddleware, PersistedSessionMiddleware), {
      onGroup() {},
      onEndpoint({ endpoint, group, middleware }) {
        if (
          group.identifier !== "api.event" &&
          group.identifier !== "api.message" &&
          group.identifier !== "api.session" &&
          group.identifier !== "api.permission" &&
          group.identifier !== "api.form"
        )
          return
        const middlewareKeys = new Set([...middleware].map(({ key }) => key))
        routes.push(
          `${endpoint.identifier}: ${middlewareKeys.has(GenericWorkspaceMiddleware.key) ? "workspace" : ""}${middlewareKeys.has(PersistedSessionMiddleware.key) ? "persisted-session" : ""}`,
        )
      },
    })

    expect(routes).toEqual([
      "session.create: workspace",
      "session.list: workspace",
      "session.active: workspace",
      "session.get: persisted-session",
      "session.update: persisted-session",
      "session.delete: persisted-session",
      "session.inbox.list: persisted-session",
      "session.prompt: persisted-session",
      "session.compact: persisted-session",
      "session.interrupt: persisted-session",
      "session.background: persisted-session",
      "session.switchAgent: persisted-session",
      "session.switchModel: persisted-session",
      "session.rename: persisted-session",
      "session.command: persisted-session",
      "session.synthetic: persisted-session",
      "session.wait: persisted-session",
      "session.generate: persisted-session",
      "session.entry.list: persisted-session",
      "session.entry.put: persisted-session",
      "session.entry.remove: persisted-session",
      "message.list: persisted-session",
      "event.subscribe: workspace",
      "permission.request.list: workspace",
      "permission.saved.list: workspace",
      "permission.saved.remove: workspace",
      "permission.tools.list: workspace",
      "permission.tools.update: workspace",
      "session.permission.create: persisted-session",
      "session.permission.list: persisted-session",
      "session.permission.get: persisted-session",
      "session.permission.reply: persisted-session",
      "form.request.list: workspace",
      "form.caller.list: workspace",
      "form.caller.get: workspace",
      "form.caller.state: workspace",
      "form.caller.reply: workspace",
      "form.caller.cancel: workspace",
      "session.form.list: persisted-session",
      "session.form.create: persisted-session",
      "session.form.get: persisted-session",
      "session.form.state: persisted-session",
      "session.form.reply: persisted-session",
      "session.form.cancel: persisted-session",
    ])
  })
})
