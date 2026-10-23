import { Form } from "@bymorning/core/form"
import { Auth } from "@bymorning/schema/auth"
import { AccountActor } from "@bymorning/schema/actor"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

const request = <A>(message: string, action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: (cause) => new TestApp.RequestError({ message, cause }) })

test("caller Form SDK routes are exact-member bound and retain their lifecycle", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const owner = yield* app.login()
        const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
        const form = yield* app.workspace({ account }, Form.Service.use((forms) =>
          forms.create({
            title: "Deploy",
            fields: [{ key: "confirm", type: "boolean", required: true }],
          }),
        ))
        const workspace = owner.properties.workspaceID
        expect(yield* request("Caller Form list failed", () => app.client.form.caller.list({ workspace }))).toEqual([form])
        expect(yield* request("Caller Form get failed", () => app.client.form.caller.get({ workspace, formID: form.id }))).toEqual(form)
        expect(yield* request("Caller Form state failed", () => app.client.form.caller.state({ workspace, formID: form.id }))).toEqual({ status: "pending" })

        yield* request("Member invite failed", () => app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }))
        const memberClient = app.clientFor()
        yield* app.login(memberClient, { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") })
        yield* request("Member caller Form list failed", () => memberClient.form.caller.list({ workspace })).pipe(
          Effect.tap((forms) => Effect.sync(() => expect(forms).toEqual([]))),
        )
        yield* request("Member caller Form get did not reject", () => memberClient.form.caller.get({ workspace, formID: form.id })).pipe(
          Effect.flip,
          Effect.tap(() => Effect.void),
        )
        yield* request("Member caller Form state did not reject", () => memberClient.form.caller.state({ workspace, formID: form.id })).pipe(
          Effect.flip,
          Effect.tap(() => Effect.void),
        )
        yield* request("Member caller Form reply did not reject", () => memberClient.form.caller.reply({ workspace, formID: form.id, answer: { confirm: true } })).pipe(
          Effect.flip,
          Effect.tap(() => Effect.void),
        )
        yield* request("Member caller Form cancel did not reject", () => memberClient.form.caller.cancel({ workspace, formID: form.id })).pipe(
          Effect.flip,
          Effect.tap(() => Effect.void),
        )

        const otherWorkspace = Workspace.ID.create()
        yield* request("Foreign Workspace Form list did not reject", () => app.client.form.caller.list({ workspace: otherWorkspace })).pipe(Effect.flip, Effect.tap(() => Effect.void))
        yield* request("Foreign Workspace Form get did not reject", () => app.client.form.caller.get({ workspace: otherWorkspace, formID: form.id })).pipe(Effect.flip, Effect.tap(() => Effect.void))
        yield* request("Foreign Workspace Form reply did not reject", () => app.client.form.caller.reply({ workspace: otherWorkspace, formID: form.id, answer: { confirm: true } })).pipe(Effect.flip, Effect.tap(() => Effect.void))
        yield* request("Foreign Workspace Form cancel did not reject", () => app.client.form.caller.cancel({ workspace: otherWorkspace, formID: form.id })).pipe(Effect.flip, Effect.tap(() => Effect.void))

        yield* request("Caller Form reply failed", () => app.client.form.caller.reply({ workspace, formID: form.id, answer: { confirm: true } }))
        expect(yield* request("Answered Form state failed", () => app.client.form.caller.state({ workspace, formID: form.id }))).toEqual({ status: "answered", answer: { confirm: true } })
        yield* request("Caller Form cancel did not reject", () => app.client.form.caller.cancel({ workspace, formID: form.id })).pipe(
          Effect.flip,
          Effect.tap(() => Effect.void),
        )
      }),
    ),
    { signal },
  )
})
