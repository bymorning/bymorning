import { Form } from "@bymorning/schema/form"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("Form decodes every field, condition, and answer value variant", () => {
  const input = [
    {
      key: "account",
      type: "string",
      title: "Account",
      description: "Account email",
      required: true,
      format: "email",
      minLength: 3,
      maxLength: 100,
      pattern: ".+@.+",
      placeholder: "team@example.com",
      default: "team@example.com",
      options: [{ value: "team@example.com", label: "Team", description: "Shared account" }],
      custom: true,
      secret: true,
      multiline: true,
    },
    {
      key: "quota",
      type: "number",
      minimum: 0,
      maximum: 10.5,
      default: 1.5,
      when: [{ key: "account", op: "neq", value: "personal@example.com" }],
    },
    {
      key: "retries",
      type: "integer",
      minimum: 0,
      maximum: 5,
      default: 2,
      when: [{ key: "quota", op: "eq", value: 1.5 }],
    },
    { key: "enabled", type: "boolean", default: true },
    {
      key: "regions",
      type: "multiselect",
      options: [{ value: "eu", label: "Europe" }],
      minItems: 1,
      maxItems: 2,
      custom: false,
      default: ["eu"],
      when: [{ key: "enabled", op: "eq", value: true }],
    },
    { key: "authorize", type: "external", url: "https://example.com/authorize", title: "Authorize" },
  ]
  const fields = Schema.decodeUnknownSync(Form.Fields)(input)
  const answer = Schema.decodeUnknownSync(Form.Answer)({
    account: "team@example.com",
    quota: 1.5,
    enabled: true,
    regions: ["eu"],
  })

  expect(fields).toEqual(input)
  expect([
    Schema.decodeUnknownSync(Form.Value)(answer.account),
    Schema.decodeUnknownSync(Form.Value)(answer.quota),
    Schema.decodeUnknownSync(Form.Value)(answer.enabled),
    Schema.decodeUnknownSync(Form.Value)(answer.regions),
  ]).toEqual(["team@example.com", 1.5, true, ["eu"]])
})

test("Form identity, lifecycle, and Session events decode", () => {
  const sessionID = Session.ID.make(crypto.randomUUID())
  const info = Form.Info.make({
    id: Form.ID.create("frm_test"),
    sessionID,
    title: "Questions",
    fields: [{ key: "name", type: "string" }],
  })
  expect(Schema.decodeUnknownSync(Form.ID)(info.id)).toBe("frm_test")
  expect(() => Schema.decodeUnknownSync(Form.ID)("bad")).toThrow()
  expect(Schema.decodeUnknownSync(Form.State)({ status: "pending" })).toEqual({ status: "pending" })
  expect(Schema.decodeUnknownSync(Form.Reply)({ answer: { name: "Ava" } })).toEqual({ answer: { name: "Ava" } })
  expect(Schema.decodeUnknownSync(SessionEvent.FormCreated.data)(info)).toEqual(info)
  expect(
    Schema.decodeUnknownSync(SessionEvent.FormReplied.data)({ id: info.id, sessionID, answer: { name: "Ava" } }),
  ).toEqual({ id: info.id, sessionID, answer: { name: "Ava" } })
  expect(Schema.decodeUnknownSync(SessionEvent.FormCancelled.data)({ id: info.id, sessionID })).toEqual({
    id: info.id,
    sessionID,
  })
})
