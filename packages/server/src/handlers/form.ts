import { Form } from "@bymorning/core/form"
import {
  FormAlreadyExistsError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InputError,
} from "@bymorning/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"

export const FormHandler = HttpApiBuilder.group(Api, "api.form", (handlers) => {
  const notFound = (id: Form.ID) => new FormNotFoundError({ id, message: `Form not found: ${id}` })
  const owned = Effect.fn("FormHandler.owned")(function* (
    sessionID: import("@bymorning/schema/session").ID,
    id: Form.ID,
  ) {
    const forms = yield* Form.Service
    const info = yield* forms.get(id).pipe(Effect.mapError(() => notFound(id)))
    if (info.sessionID !== sessionID) return yield* notFound(id)
    return info
  })
  return handlers
    .handle("form.request.list", () => Form.Service.use((forms) => forms.list()))
    // Workspace middleware supplies Form from the authenticated actor's member graph. Form IDs
    // are consequently never resolved against another member's registry.
    .handle("form.caller.list", () => Form.Service.use((forms) => forms.list()))
    .handle("form.caller.get", ({ params }) => Form.Service.use((forms) => forms.get(params.formID)).pipe(Effect.mapError(() => notFound(params.formID))))
    .handle("form.caller.state", ({ params }) =>
      Form.Service.use((forms) => forms.state(params.formID).pipe(Effect.mapError(() => notFound(params.formID)))),
    )
    .handle("form.caller.reply", ({ params, payload }) =>
      Form.Service.use((forms) => forms.reply({ id: params.formID, answer: payload.answer })).pipe(
        Effect.catchTags({
          "Form.NotFoundError": () => notFound(params.formID),
          "Form.AlreadySettledError": (error) => new FormAlreadySettledError({ id: error.id, message: error.message }),
          "Form.InvalidAnswerError": (error) => new FormInvalidAnswerError({ id: error.id, message: error.message }),
        }),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("form.caller.cancel", ({ params }) =>
      Form.Service.use((forms) => forms.cancel(params.formID)).pipe(
        Effect.catchTags({
          "Form.NotFoundError": () => notFound(params.formID),
          "Form.AlreadySettledError": (error) => new FormAlreadySettledError({ id: error.id, message: error.message }),
        }),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("session.form.list", ({ params }) =>
      Form.Service.use((forms) => forms.list({ sessionID: params.sessionID })),
    )
    .handle("session.form.create", ({ params, payload }) =>
      Form.Service.use((forms) => forms.create({ ...payload, sessionID: params.sessionID })).pipe(
        Effect.catchTags({
          "Form.AlreadyExistsError": (error) => new FormAlreadyExistsError({ id: error.id, message: error.message }),
          "Form.InvalidFormError": (error) => new InputError({ error: error.message }),
        }),
      ),
    )
    .handle("session.form.get", ({ params }) => owned(params.sessionID, params.formID))
    .handle("session.form.state", ({ params }) =>
      owned(params.sessionID, params.formID).pipe(
        Effect.andThen(
          Form.Service.use((forms) => forms.state(params.formID).pipe(Effect.mapError(() => notFound(params.formID)))),
        ),
      ),
    )
    .handle("session.form.reply", ({ params, payload }) =>
      owned(params.sessionID, params.formID).pipe(
        Effect.andThen(
          Form.Service.use((forms) => forms.reply({ id: params.formID, answer: payload.answer })).pipe(
            Effect.catchTags({
              "Form.NotFoundError": () => notFound(params.formID),
              "Form.AlreadySettledError": (error) =>
                new FormAlreadySettledError({ id: error.id, message: error.message }),
              "Form.InvalidAnswerError": (error) =>
                new FormInvalidAnswerError({ id: error.id, message: error.message }),
            }),
          ),
        ),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("session.form.cancel", ({ params }) =>
      owned(params.sessionID, params.formID).pipe(
        Effect.andThen(
          Form.Service.use((forms) => forms.cancel(params.formID)).pipe(
            Effect.catchTags({
              "Form.NotFoundError": () => notFound(params.formID),
              "Form.AlreadySettledError": (error) =>
                new FormAlreadySettledError({ id: error.id, message: error.message }),
            }),
          ),
        ),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
})
