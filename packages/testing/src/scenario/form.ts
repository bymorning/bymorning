/** Real pending Form setup shared by browser consumers. */
export * as FormScenario from "./form.js"

import { Form } from "@bymorning/core/form"
import { Effect } from "effect"
import type { TestApp } from "../application.js"
import type { Chat } from "./chat.js"

/** Create a pending, schema-validated Form through the public Form authority. */
export const create = Effect.fn("FormScenario.create")(function* (app: TestApp.Interface, data: Chat.Data) {
  return yield* app.workspace(
    { account: data.account },
    Form.Service.use((forms) =>
      forms.create({
        sessionID: data.session.id,
        title: "Fixture details",
        fields: [
          { key: "answer", type: "string", title: "Answer", required: true },
          { key: "more", type: "string", title: "More", when: [{ key: "answer", op: "eq", value: "yes" }] },
        ],
      }),
    ),
  )
})

/** Create a pending integer Form through the same public Form authority. */
export const createInteger = Effect.fn("FormScenario.createInteger")(function* (app: TestApp.Interface, data: Chat.Data) {
  return yield* app.workspace(
    { account: data.account },
    Form.Service.use((forms) =>
      forms.create({
        sessionID: data.session.id,
        title: "Fixture count",
        fields: [{ key: "count", type: "integer", title: "Count", required: true }],
      }),
    ),
  )
})

/** Create a caller-bound Form without creating or fabricating a conversation Session. */
export const createCaller = Effect.fn("FormScenario.createCaller")(function* (app: TestApp.Interface, data: Chat.Data) {
  return yield* app.workspace(
    { account: data.account },
    Form.Service.use((forms) =>
      forms.create({
        title: "Authorize connection",
        fields: [
          { key: "review", type: "external", title: "Authorization page", url: "https://example.test/authorize" },
          {
            key: "action",
            type: "string",
            title: "Decision",
            required: true,
            options: [
              { value: "continue", label: "Continue" },
              { value: "decline", label: "Decline" },
            ],
          },
        ],
      }),
    ),
  )
})
