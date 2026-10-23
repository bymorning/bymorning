import { NodeCrypto } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { Bus } from "../src/bus.js"
import { Database } from "../src/database.js"
import { Form } from "../src/form.js"

const workspaceID = Workspace.ID.make("wrk_form_service")
const database = Layer.succeed(
  Database.Service,
  Database.Service.of({
    use: (_label, operation) => operation(undefined as never),
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: Effect.asVoid,
  }),
)
const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
const layer = Layer.merge(bus, Form.layer.pipe(Layer.provide(bus)))
const sessionID = () => Session.ID.make(crypto.randomUUID())
const input = (id = Form.ID.create()): Form.CreateInput => ({
  id,
  sessionID: sessionID(),
  title: "Test form",
  fields: [{ key: "name", type: "string", required: true }],
})
const run = <A, E>(effect: Effect.Effect<A, E, Form.Service | Bus.Service>) =>
  Effect.scoped(effect).pipe(Effect.provide(layer))

const waitPending = (forms: Form.Interface, id: Form.ID) =>
  Effect.gen(function* () {
    while (true) {
      if ((yield* forms.list()).some((form) => form.id === id)) return
      yield* Effect.sleep("1 millis")
    }
  })

describe("Form.Service", () => {
  it.effect("creates, lists, filters, gets, and reports pending state", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const created = yield* forms.create(input())
        expect(yield* forms.get(created.id)).toEqual(created)
        expect(yield* forms.state(created.id)).toEqual({ status: "pending" })
        expect(yield* forms.list()).toEqual([created])
        expect(yield* forms.list({ sessionID: created.sessionID })).toEqual([created])
        expect(yield* forms.list({ sessionID: sessionID() })).toEqual([])
      }),
    ),
  )

  it.effect("supports a caller-bound Form without fabricating a Session", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const created = yield* forms.create({
          title: "Confirm deployment",
          fields: [{ key: "confirm", type: "boolean", required: true }],
        })
        expect(created.sessionID).toBeUndefined()
        expect(yield* forms.list()).toEqual([created])
        yield* forms.reply({ id: created.id, answer: { confirm: true } })
        expect(yield* forms.state(created.id)).toEqual({ status: "answered", answer: { confirm: true } })
      }),
    ),
  )

  it.effect("returns answered and cancelled terminal states and retains them", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const answeredInput = input()
        const [answered] = yield* Effect.all(
          [
            forms.ask(answeredInput),
            waitPending(forms, answeredInput.id!).pipe(
              Effect.andThen(forms.reply({ id: answeredInput.id!, answer: { name: "Ava" } })),
            ),
          ],
          { concurrency: "unbounded" },
        )
        expect(answered).toEqual({ status: "answered", answer: { name: "Ava" } })
        expect(yield* forms.state(answeredInput.id!)).toEqual({ status: "answered", answer: { name: "Ava" } })

        const cancelledInput = input()
        const [cancelled] = yield* Effect.all(
          [
            forms.ask(cancelledInput),
            waitPending(forms, cancelledInput.id!).pipe(Effect.andThen(forms.cancel(cancelledInput.id!))),
          ],
          { concurrency: "unbounded" },
        )
        expect(cancelled).toEqual({ status: "cancelled" })
        expect(yield* forms.state(cancelledInput.id!)).toEqual({ status: "cancelled" })
        expect(yield* forms.list()).toEqual([])
      }),
    ),
  )

  it.effect("allows declared back navigation without validating unfinished fields", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const request: Form.CreateInput = {
          ...input(Form.ID.create("frm_back")),
          metadata: {
            navigation: { actionKey: "__externalServerWizardAction", backValue: "back" },
          },
          fields: [
            {
              key: "__externalServerWizardAction",
              type: "string" as const,
              options: [
                { value: "next", label: "Next" },
                { value: "back", label: "Back" },
              ],
            },
            { key: "name", type: "string" as const, required: true },
          ],
        }
        const [answered] = yield* Effect.all(
          [
            forms.ask(request),
            waitPending(forms, request.id!).pipe(
              Effect.andThen(forms.reply({ id: request.id!, answer: { __externalServerWizardAction: "back" } })),
            ),
          ],
          { concurrency: "unbounded" },
        )

        expect(answered).toEqual({
          status: "answered",
          answer: { __externalServerWizardAction: "back" },
        })
      }),
    ),
  )

  it.effect("rejects duplicate, missing, settled, invalid form, and invalid answer operations", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const request = input(Form.ID.create("frm_errors"))
        yield* forms.create(request)
        expect(yield* forms.create(request).pipe(Effect.flip)).toEqual(new Form.AlreadyExistsError({ id: request.id! }))
        const missing = Form.ID.create("frm_missing")
        expect(yield* forms.reply({ id: missing, answer: {} }).pipe(Effect.flip)).toEqual(
          new Form.NotFoundError({ id: missing }),
        )
        expect(yield* forms.reply({ id: request.id!, answer: {} }).pipe(Effect.flip)).toEqual(
          new Form.InvalidAnswerError({ id: request.id!, message: "Missing required form field: name" }),
        )
        yield* forms.reply({ id: request.id!, answer: { name: "Ava" } })
        expect(yield* forms.cancel(request.id!).pipe(Effect.flip)).toEqual(
          new Form.AlreadySettledError({ id: request.id! }),
        )
        expect(
          yield* forms
            .create({
              sessionID: sessionID(),
              title: "Invalid",
              fields: [
                { key: "a", type: "string" },
                { key: "a", type: "string" },
              ],
            })
            .pipe(Effect.flip),
        ).toEqual(new Form.InvalidFormError({ message: "Duplicate form field key: a" }))
      }),
    ),
  )

  it.effect("preserves when, multiselect, cascading, and external validation behavior", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const conditional = yield* forms.create({
          sessionID: sessionID(),
          title: "Conditional",
          fields: [
            { key: "confirm", type: "boolean", required: true },
            { key: "reason", type: "string", required: true, when: [{ key: "confirm", op: "eq", value: false }] },
          ],
        })
        expect(
          yield* forms.reply({ id: conditional.id, answer: { confirm: true, reason: "x" } }).pipe(Effect.flip),
        ).toEqual(new Form.InvalidAnswerError({ id: conditional.id, message: "Form field is not active: reason" }))
        yield* forms.reply({ id: conditional.id, answer: { confirm: true } })

        const multiselect = yield* forms.create({
          sessionID: sessionID(),
          title: "Multiselect",
          fields: [
            { key: "langs", type: "multiselect", options: [{ value: "go", label: "Go" }] },
            { key: "version", type: "string", required: true, when: [{ key: "langs", op: "neq", value: "go" }] },
          ],
        })
        expect(yield* forms.reply({ id: multiselect.id, answer: { langs: [] } }).pipe(Effect.flip)).toEqual(
          new Form.InvalidAnswerError({ id: multiselect.id, message: "Missing required form field: version" }),
        )

        const external = yield* forms.create({
          sessionID: sessionID(),
          title: "External",
          fields: [{ key: "authorization", type: "external", url: "https://example.com" }],
        })
        expect(yield* forms.reply({ id: external.id, answer: {} }).pipe(Effect.flip)).toEqual(
          new Form.InvalidAnswerError({
            id: external.id,
            message: "External form field must be acknowledged: authorization",
          }),
        )
      }),
    ),
  )

  it.effect("publishes created, replied, and cancelled events with top-level Session ownership", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const events = yield* Bus.Service
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* events.subscribe([
              SessionEvent.FormCreated,
              SessionEvent.FormReplied,
              SessionEvent.FormCancelled,
            ])
            const actions = Effect.gen(function* () {
              const answered = yield* forms.create(input())
              yield* forms.reply({ id: answered.id, answer: { name: "Ava" } })
              const cancelled = yield* forms.create(input())
              yield* forms.cancel(cancelled.id)
              return { answered, cancelled }
            })
            const [payloads, created] = yield* Effect.all([stream.pipe(Stream.take(4), Stream.runCollect), actions], {
              concurrency: "unbounded",
            })
            return { ...created, payloads: Array.from(payloads) }
          }),
        )
        const { answered, cancelled, payloads } = result
        expect(payloads.map((event) => event.type)).toEqual([
          "form.created",
          "form.replied",
          "form.created",
          "form.cancelled",
        ])
        expect(payloads[0]?.data.sessionID).toBe(answered.sessionID)
        expect(payloads[3]?.data.sessionID).toBe(cancelled.sessionID)
      }),
    ),
  )

  it.effect("cancels pending Forms when its layer closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(layer, scope)
      const forms = Context.get(context, Form.Service)
      const created = yield* forms.create(input())
      yield* Scope.close(scope, Exit.void)
      expect(yield* forms.state(created.id)).toEqual({ status: "cancelled" })
    }),
  )

  it.effect("cancels a pending Form when ask is interrupted", () =>
    run(
      Effect.gen(function* () {
        const forms = yield* Form.Service
        const request = input()
        const fiber = yield* forms.ask(request).pipe(Effect.forkChild({ startImmediately: true }))
        yield* waitPending(forms, request.id!)

        yield* Fiber.interrupt(fiber)
        while ((yield* forms.state(request.id!)).status !== "cancelled") yield* Effect.sleep("1 millis")

        expect(yield* forms.state(request.id!)).toEqual({ status: "cancelled" })
        expect(yield* forms.list()).toEqual([])
      }),
    ),
  )
})
