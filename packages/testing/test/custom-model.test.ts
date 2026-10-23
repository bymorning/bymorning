import { Config } from "@bymorning/core/config"
import { Audit } from "@bymorning/core/audit"
import { Auth as AuthSchema } from "@bymorning/schema/auth"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

/** Every custom Model change through the generated SDK, against the real Config, Catalog, Audit, and model pipeline. */
test("Workspace administrators add, edit, and remove custom Models that execute by upstream name", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const workspace = data.owner.properties.workspaceID
      const provider = Provider.OpenCode
      const created = yield* Effect.tryPromise(() =>
        app.client.model.create({
          workspace,
          provider,
          name: "Pinned DeepSeek",
          apiID: "deepseek-pinned-upstream",
          cost: { input: 2, output: 8 },
          limit: { context: 64_000 },
        }),
      )
      expect(created).toMatchObject({
        custom: true,
        enabled: true,
        info: {
          provider,
          id: "deepseek-pinned-upstream",
          name: "Pinned DeepSeek",
          apiID: "deepseek-pinned-upstream",
          cost: { input: 2, output: 8 },
          limit: { context: 64_000 },
        },
      })
      const model = { provider, id: created.info.id }
      const listed = yield* Effect.tryPromise(() => app.client.model.list({ workspace, provider }))
      expect(listed.filter((row) => row.custom === true).map((row) => row.info.id)).toEqual([model.id])

      // A key the Provider already uses is refused rather than replacing that Model.
      const conflict = yield* Effect.tryPromise(() =>
        app.client.model.create({ workspace, provider, name: "Shadow", apiID: Chat.model.id }),
      ).pipe(Effect.flip)
      expect(conflict.cause).toMatchObject({ _tag: "Protocol.InputError" })
      expect(JSON.stringify(conflict.cause)).toContain("already has a Model with the key deepseek-v4-pro")
      // Bundled Models can be disabled but not edited.
      const bundled = yield* Effect.tryPromise(() =>
        app.client.model.update({ workspace, ...Chat.model, name: "Renamed", apiID: "elsewhere" }),
      ).pipe(Effect.flip)
      expect(bundled.cause).toMatchObject({ _tag: "Protocol.InputError" })

      const updated = yield* Effect.tryPromise(() =>
        app.client.model.update({ workspace, ...model, name: "Pinned DeepSeek v2", apiID: "deepseek-pinned-v2" }),
      )
      expect(updated.info).toMatchObject({ id: model.id, name: "Pinned DeepSeek v2", apiID: "deepseek-pinned-v2" })
      // Replacing the configuration drops prices the update no longer states.
      expect(updated.info.cost.input).toBeUndefined()

      // A conversation on the custom Model sends its upstream name to the Provider.
      const session = yield* Effect.tryPromise(() => app.client.session.create({ projectID: data.project.id, model }))
      yield* app.llm.expect(session.id, "generate", [
        {
          expect: (request) => expect(request.model).toBe("deepseek-pinned-v2"),
          response: { type: "success", events: [{ text: "Custom answer" }], usage: { input: 3, output: 2 } },
        },
      ])
      const generated = yield* Effect.tryPromise(() =>
        app.client.session.generate({ sessionID: session.id, prompt: "Answer through the custom Model" }),
      )
      expect(generated.text).toBe("Custom answer")

      // Members can see custom Models but not configure them.
      yield* Effect.tryPromise(() =>
        app.client.user.invite({ email: AuthSchema.Email.make("member@bymorning.ai"), role: "member" }),
      )
      const memberClient = app.clientFor()
      yield* app.login(memberClient, {
        subject: AuthSchema.Sub.make("custom-model-member"),
        email: AuthSchema.Email.make("member@bymorning.ai"),
      })
      const forbidden = yield* Effect.tryPromise(() =>
        memberClient.model.create({ workspace, provider, name: "Member", apiID: "member-upstream" }),
      ).pipe(Effect.flip)
      expect(forbidden.cause).toMatchObject({ _tag: "ForbiddenError" })
      expect(
        (yield* Effect.tryPromise(() => memberClient.model.list({ workspace, provider }))).some(
          (row) => row.info.id === model.id && row.custom === true,
        ),
      ).toBe(true)

      // Disabling then removing leaves no enablement state behind, and execution is refused.
      yield* Effect.tryPromise(() => app.client.model.toggle({ workspace, ...model, enabled: false }))
      yield* Effect.tryPromise(() => app.client.model.delete({ workspace, ...model }))
      const after = yield* Effect.tryPromise(() => app.client.model.list({ workspace, provider }))
      expect(after.some((row) => row.info.id === model.id)).toBe(false)
      // The persisted Workspace Config keeps neither the custom Model nor its disabled state.
      const stored = yield* app.workspace(
        { account: data.account },
        Config.Service.use((config) => config.refresh),
      )
      expect(stored.models ?? []).toEqual([])
      expect(stored.model_policy.disabled.some((entry) => entry.id === model.id)).toBe(false)
      yield* Effect.tryPromise(() =>
        expect(app.client.session.generate({ sessionID: session.id, prompt: "Must be refused" })).rejects.toBeDefined(),
      )
      const missing = yield* Effect.tryPromise(() => app.client.model.delete({ workspace, ...model })).pipe(Effect.flip)
      expect(missing.cause).toMatchObject({ _tag: "Protocol.InputError" })

      // Each change is audited with the administrator as actor.
      const entries = (yield* app.process(
        Audit.Service.use((audit) =>
          audit.list({ actions: ["model.create", "model.update", "model.delete"], limit: 100 }),
        ),
      )).data
      expect(entries.map((entry) => [entry.action, entry.target, entry.outcome])).toEqual(
        expect.arrayContaining([
          ["model.create", `${provider}/${model.id}`, "success"],
          ["model.update", `${provider}/${model.id}`, "success"],
          ["model.delete", `${provider}/${model.id}`, "success"],
        ]),
      )
      expect(entries).toHaveLength(3)
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)
