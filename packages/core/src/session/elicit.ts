/** Session Form projection for a Tool elicitation callback. */
export * as SessionElicit from "./elicit.js"

import { Effect } from "effect"
import { Form } from "../form.js"
import { Tool } from "../tool.js"

const actionBase = "__bymorning_elicit_action"

export const ask = Effect.fn("SessionElicit.ask")(function* (
  sessionID: import("@bymorning/schema/session").Session.ID,
  input: Tool.ElicitInput,
) {
  const forms = yield* Form.Service
  const action = actionKey(input.mode === "form" ? input.fields : [])
  const fields =
    input.mode === "form"
      ? projectFields(input.fields, action)
      : [
          control(action),
          {
            key: "__bymorning_elicit_url",
            type: "external" as const,
            url: input.url,
            title: input.message,
          },
        ] as Form.Fields as Form.Fields
  const state = yield* forms
    .ask({
      sessionID,
      title: input.title,
      metadata: { kind: "tool-elicitation", mode: input.mode, message: input.message },
      fields,
    })
    .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message, error })))
  if (state.status === "cancelled") return { action: "cancel" as const }
  if (state.answer[action] === "decline") return { action: "decline" as const }
  const answer = { ...state.answer }
  delete answer[action]
  if (input.mode === "url") delete answer.__bymorning_elicit_url
  return { action: "accept" as const, answer }
})

const actionKey = (fields: ReadonlyArray<Form.Field>) => {
  const keys = new Set(fields.map((field) => field.key))
  let key = actionBase
  let index = 1
  while (keys.has(key)) key = `${actionBase}_${index++}`
  return key
}

const control = (key: string): Form.Field => ({
  key,
  type: "string",
  title: "Response",
  required: true,
  options: [
    { value: "accept", label: "Continue", description: "Continue with this request." },
    { value: "decline", label: "Decline", description: "Decline this request." },
  ],
})

const projectFields = (fields: Form.Fields, action: string): Form.Fields =>
  [
    control(action),
    ...fields.map((field) =>
      field.type === "external"
        ? field
        : { ...field, when: [{ key: action, op: "eq" as const, value: "accept" }, ...(field.when ?? [])] },
    ),
  ] as Form.Fields
