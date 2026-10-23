export * as Form from "./form.js"

import { Form } from "@bymorning/schema/form"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Context, Deferred, Effect, Layer, Schema, Semaphore } from "effect"
import { Bus } from "./bus.js"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"

export const ID = Form.ID
export type ID = Form.ID

export const Info = Form.Info
export type Info = Form.Info

export const Field = Form.Field
export type Field = Form.Field

export const Fields = Form.Fields
export type Fields = Form.Fields

export const Answer = Form.Answer
export type Answer = typeof Answer.Type

export const State = Form.State
export type State = Form.State
export type TerminalState = Exclude<State, { readonly status: "pending" }>

export const Reply = Form.Reply
export type Reply = Form.Reply

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Form.NotFoundError", { id: ID }) {
  override get message() {
    return `Form not found: ${this.id}`
  }
}

export class AlreadySettledError extends Schema.TaggedError<AlreadySettledError>()("Form.AlreadySettledError", {
  id: ID,
}) {
  override get message() {
    return `Form already settled: ${this.id}`
  }
}

export class AlreadyExistsError extends Schema.TaggedError<AlreadyExistsError>()("Form.AlreadyExistsError", {
  id: ID,
}) {
  override get message() {
    return `Form already exists: ${this.id}`
  }
}

export class InvalidAnswerError extends Schema.TaggedError<InvalidAnswerError>()("Form.InvalidAnswerError", {
  id: ID,
  message: Schema.String,
}) {}

export class InvalidFormError extends Schema.TaggedError<InvalidFormError>()("Form.InvalidFormError", {
  message: Schema.String,
}) {}

export type CreateInput = Omit<Info, "id"> & { readonly id?: ID }
export interface ReplyInput {
  readonly id: ID
  readonly answer: Answer
}
export interface ListInput {
  readonly sessionID?: Session.ID
}
export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, AlreadyExistsError | InvalidFormError>
  readonly ask: (input: CreateInput) => Effect.Effect<TerminalState, AlreadyExistsError | InvalidFormError>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly state: (id: ID) => Effect.Effect<State, NotFoundError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, AlreadySettledError | InvalidAnswerError | NotFoundError>
  readonly cancel: (id: ID) => Effect.Effect<void, AlreadySettledError | NotFoundError>
}
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Form") {}

interface Entry {
  readonly form: Info
  readonly state: State
  readonly deferred: Deferred.Deferred<TerminalState>
  readonly retainUntil?: number
}

const Retention = 10 * 60 * 1_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const lock = Semaphore.makeUnsafe(1)
    const entries = new Map<ID, Entry>()
    const purge = () => {
      const now = Date.now()
      for (const [id, entry] of entries)
        if (entry.retainUntil !== undefined && entry.retainUntil <= now) entries.delete(id)
    }
    const requireEntry = (id: ID) =>
      Effect.sync(() => {
        purge()
        return entries.get(id)
      }).pipe(
        Effect.flatMap((entry) =>
          entry === undefined ? Effect.fail(new NotFoundError({ id })) : Effect.succeed(entry),
        ),
      )

    const create = Effect.fn("Form.create")((input: CreateInput) =>
      Effect.uninterruptible(
        lock.withPermit(
          Effect.gen(function* () {
            purge()
            const id = input.id ?? ID.create()
            if (entries.has(id)) return yield* new AlreadyExistsError({ id })
            const invalid = validateFields(input.fields)
            if (invalid !== undefined) return yield* new InvalidFormError({ message: invalid })
            const form = Info.make({ ...input, id })
            const deferred = yield* Deferred.make<TerminalState>()
            entries.set(id, { form, state: { status: "pending" }, deferred })
            const sessionID = form.sessionID
            if (sessionID !== undefined)
              yield* bus.publish(SessionEvent.FormCreated, { ...form, sessionID }).pipe(
                Effect.onError(() => Effect.sync(() => entries.delete(id))),
                Effect.orDie,
              )
            return form
          }),
        ),
      ),
    )
    const get = Effect.fn("Form.get")((id: ID) =>
      lock.withPermit(requireEntry(id).pipe(Effect.map((entry) => entry.form))),
    )
    const state = Effect.fn("Form.state")((id: ID) =>
      lock.withPermit(requireEntry(id).pipe(Effect.map((entry) => entry.state))),
    )
    const list = Effect.fn("Form.list")((input?: ListInput) =>
      lock.withPermit(
        Effect.sync(() => {
          purge()
          return Array.from(entries.values())
            .filter(
              (entry) =>
                entry.state.status === "pending" &&
                (input?.sessionID === undefined || entry.form.sessionID === input.sessionID),
            )
            .map((entry) => entry.form)
        }),
      ),
    )
    const cancel = Effect.fn("Form.cancel")((id: ID) =>
      Effect.uninterruptible(
        lock.withPermit(
          Effect.gen(function* () {
            const entry = yield* requireEntry(id)
            if (entry.state.status !== "pending") return yield* new AlreadySettledError({ id })
            const terminal = { status: "cancelled" as const }
            if (entry.form.sessionID !== undefined)
              yield* bus
                .publish(SessionEvent.FormCancelled, { id, sessionID: entry.form.sessionID })
                .pipe(Effect.orDie)
            entries.set(id, { ...entry, state: terminal, retainUntil: Date.now() + Retention })
            yield* Deferred.succeed(entry.deferred, terminal)
          }),
        ),
      ),
    )
    const reply = Effect.fn("Form.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        lock.withPermit(
          Effect.gen(function* () {
            const entry = yield* requireEntry(input.id)
            if (entry.state.status !== "pending") return yield* new AlreadySettledError({ id: input.id })
            const invalid = isBackNavigation(entry.form, input.answer)
              ? undefined
              : validateAnswer(entry.form.fields, input.answer)
            if (invalid !== undefined) return yield* new InvalidAnswerError({ id: input.id, message: invalid })
            const terminal = { status: "answered" as const, answer: input.answer }
            if (entry.form.sessionID !== undefined)
              yield* bus
                .publish(SessionEvent.FormReplied, {
                  id: input.id,
                  sessionID: entry.form.sessionID,
                  answer: input.answer,
                })
                .pipe(Effect.orDie)
            entries.set(input.id, { ...entry, state: terminal, retainUntil: Date.now() + Retention })
            yield* Deferred.succeed(entry.deferred, terminal)
          }),
        ),
      ),
    )
    const ask = Effect.fn("Form.ask")((input: CreateInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const form = yield* create(input)
          const entry = yield* requireEntry(form.id).pipe(Effect.orDie)
          return yield* restore(Deferred.await(entry.deferred)).pipe(
            Effect.onInterrupt(() => cancel(form.id).pipe(Effect.ignore)),
          )
        }),
      ),
    )
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        Array.from(entries.values()).filter((entry) => entry.state.status === "pending"),
        (entry) => cancel(entry.form.id).pipe(Effect.ignore),
        { discard: true },
      ),
    )
    return Service.of({ create, ask, get, list, state, reply, cancel })
  }),
)

/** Canonical member Form registry over the workspace Bus. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [Bus.node] })

export function validateAnswer(form: ReadonlyArray<Form.Field>, answer: Answer) {
  const fields = new Map(form.map((field) => [field.key, field] as const))
  for (const key of Object.keys(answer)) {
    if (!fields.has(key)) return `Unknown form field: ${key}`
  }
  for (const field of form) {
    const value = answer[field.key]
    if (field.type === "external") {
      if (value !== true) return `External form field must be acknowledged: ${field.key}`
      continue
    }
    const active = isActive(field, answer)
    if (value === undefined) {
      if (field.required && active) return `Missing required form field: ${field.key}`
      continue
    }
    if (!active) return `Form field is not active: ${field.key}`
    const invalid = validateField(field, value)
    if (invalid) return invalid
  }
}

function isBackNavigation(form: Info, answer: Answer) {
  const navigation = form.metadata?.navigation
  if (typeof navigation !== "object" || navigation === null || Array.isArray(navigation)) return false
  const actionKey = "actionKey" in navigation ? navigation.actionKey : undefined
  const backValue = "backValue" in navigation ? navigation.backValue : undefined
  if (typeof actionKey !== "string" || typeof backValue !== "string" || answer[actionKey] !== backValue) return false
  const action = form.fields.find((field) => field.key === actionKey)
  return action?.type === "string" && action.options?.some((option) => option.value === backValue) === true
}

type InputField = Exclude<Form.Field, Form.ExternalField>

function isActive(field: InputField, answer: Answer) {
  if (!field.when) return true
  return field.when.every((when) => matches(when, answer[when.key]))
}

// An unanswered referenced field makes the condition false for both ops. Combined with inactive
// fields being unanswerable, this cascades: hiding a field falsifies every condition referencing it.
function matches(when: Form.When, value: Form.Value | undefined) {
  if (value === undefined) return false
  const hit = Array.isArray(value) ? value.some((item) => item === when.value) : value === when.value
  return when.op === "eq" ? hit : !hit
}

// Create-time validation of `when` references: each condition must point at an earlier field,
// carry a value matching that field's type, and use a declared option when the field's options
// are closed. Rejecting these at creation surfaces authoring mistakes to the caller instead of
// silently never matching.
export function validateFields(fields: ReadonlyArray<Form.Field>) {
  if (fields.length === 0) return "Form must have at least one field"
  const earlier = new Map<string, InputField>()
  const keys = new Set<string>()
  for (const field of fields) {
    if (keys.has(field.key)) return `Duplicate form field key: ${field.key}`
    keys.add(field.key)
    if (field.type === "string" && field.secret && field.default !== undefined) {
      return `Secret form field cannot have a default: ${field.key}`
    }
    if (field.type === "string" && field.secret && field.multiline) {
      return `Secret form field cannot be multiline: ${field.key}`
    }
    if (field.type === "external") continue
    for (const when of field.when ?? []) {
      const target = earlier.get(when.key)
      if (!target) return `Form field condition must reference an earlier field: ${field.key} -> ${when.key}`
      const invalid = validateWhen(when, target)
      if (invalid) return `${invalid}: ${field.key} -> ${when.key}`
    }
    earlier.set(field.key, field)
  }
}

function validateWhen(when: Form.When, target: InputField) {
  if (target.type === "boolean") {
    if (typeof when.value !== "boolean") return "Form field condition value must be a boolean"
    return
  }
  if (target.type === "number" || target.type === "integer") {
    if (typeof when.value !== "number") return "Form field condition value must be a number"
    return
  }
  // string and multiselect targets both compare against string values
  if (typeof when.value !== "string") return "Form field condition value must be a string"
  const closed = target.type === "multiselect" ? !target.custom : target.options !== undefined && !target.custom
  if (closed && !target.options?.some((option) => option.value === when.value)) {
    return "Form field condition value must be one of the field's options"
  }
}

function validateField(field: InputField, value: Form.Value): string | undefined {
  if (field.type === "string") {
    if (typeof value !== "string") return `Expected string for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minLength !== undefined && value.length < field.minLength) return `Form field is too short: ${field.key}`
    if (field.maxLength !== undefined && value.length > field.maxLength) return `Form field is too long: ${field.key}`
    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) return `Form field does not match pattern: ${field.key}`
      } catch {
        return `Form field has invalid pattern: ${field.key}`
      }
    }
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return `Expected email for form field: ${field.key}`
    if (field.format === "uri" && !isUri(value)) return `Expected URI for form field: ${field.key}`
    if (field.format === "date" && !isDate(value)) return `Expected date for form field: ${field.key}`
    if (field.format === "date-time" && !isDateTime(value)) return `Expected date-time for form field: ${field.key}`
    if (field.options && !field.custom && !field.options.some((option) => option.value === value)) {
      return `Invalid option for form field: ${field.key}`
    }
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `Expected number for form field: ${field.key}`
    if (field.type === "integer" && !Number.isInteger(value)) return `Expected integer for form field: ${field.key}`
    if (field.minimum !== undefined && value < field.minimum) return `Form field is too small: ${field.key}`
    if (field.maximum !== undefined && value > field.maximum) return `Form field is too large: ${field.key}`
    return
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return `Expected boolean for form field: ${field.key}`
    return
  }
  if (field.type === "multiselect") {
    if (!isStringArray(value)) return `Expected string array for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minItems !== undefined && value.length < field.minItems)
      return `Too few selections for form field: ${field.key}`
    if (field.maxItems !== undefined && value.length > field.maxItems)
      return `Too many selections for form field: ${field.key}`
    if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item))) {
      return `Invalid option for form field: ${field.key}`
    }
  }
}

function isStringArray(value: Form.Value): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
}

function isUri(value: string) {
  return URL.canParse(value)
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isDateTime(value: string) {
  return !Number.isNaN(new Date(value).getTime())
}
