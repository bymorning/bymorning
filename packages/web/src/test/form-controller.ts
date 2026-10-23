import type { Form } from "@bymorning/schema/form"
import type { FormInfo } from "@bymorning/client"
import { QueryClient, useMutation } from "@tanstack/solid-query"
import { createController } from "../features/session/form-controller"

type Source = Parameters<typeof createController>[0]

/** Controller tests use native execution state around their controlled operation. */
export function createFormController(source: Source) {
  const query = new QueryClient()
  const mutation = useMutation(
    () => ({
      retry: false,
      mutationFn: (input: { form: FormInfo; action: "submit" | "back" | "cancel"; answer?: Form.Answer }) =>
        input.action === "cancel"
          ? source.form.cancel(input.form)
          : source.form.reply(input.form, input.answer!, input.action),
    }),
    () => query,
  )
  const matches = (form: FormInfo) => {
    const submitted = mutation.variables?.form
    return submitted?.id === form.id && JSON.stringify(submitted.fields) === JSON.stringify(form.fields)
  }
  return createController({
    ...source,
    form: {
      reply: (form, answer, action = "submit") => mutation.mutateAsync({ form, answer, action }),
      cancel: (form) => mutation.mutateAsync({ form, action: "cancel" }),
      pendingAction: (form) => (matches(form) && mutation.isPending ? mutation.variables?.action : undefined),
      error: (form) => (matches(form) ? mutation.error?.message : undefined),
    },
  })
}
