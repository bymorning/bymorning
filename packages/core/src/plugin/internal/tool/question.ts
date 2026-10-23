import { Question } from "@bymorning/schema/question"
import { Tool } from "../../../tool.js"
import { Effect, Schema, SchemaTransformation } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { Form } from "../../../form.js"
import { Permission } from "../../../permission.js"

export const name = "question"
export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "Type your own answer" option is added automatically; don't include a separate option for free form answers
- Set \`multiple: true\` to allow selecting more than one option
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

// Some models encode nested option arrays as { item: [...] }. Decode that wire
// shape here so Form and the shared Question schema still receive arrays.
const Options = Question.Prompt.fields.options
const Prompt = Question.Prompt.pipe(
  Schema.fieldsAssign({
    options: Schema.Union([Options, Schema.Struct({ item: Options })]).pipe(
      Schema.decodeTo(
        Options,
        SchemaTransformation.transform({
          decode: (value) => ("item" in value ? value.item : value),
          encode: (value) => value,
        }),
      ),
    ),
  }),
)

export const Input = Schema.Struct({
  questions: Schema.NonEmptyArray(Prompt).annotate({ description: "Questions to ask" }),
})
export const Output = Schema.Struct({ answers: Schema.Array(Question.Answer) })

export const toModelContent = (questions: ReadonlyArray<Question.Prompt>, answers: ReadonlyArray<Question.Answer>) =>
  `User has answered your questions: ${questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")}. You can now continue with the user's answers in mind.`

export const QuestionTool = {
  name,
  options: { codemode: false },
  description,
  input: Input,
  output: Output,
  execute,
}

export function execute(input: typeof Input.Type, context: Tool.Context) {
  return Effect.gen(function* () {
    if (context.caller.type !== "session")
      return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
    const sessionID = context.caller.sessionID
    const forms = yield* Form.Service
    yield* context.permission({ action: "question", resources: ["*"] })
    const first = input.questions[0]
    const state = yield* forms
      .ask({
        sessionID: sessionID,
        title: "Questions",
        metadata: { kind: "question", callID: context.id },
        fields: [toField(first, 0), ...input.questions.slice(1).map((question, index) => toField(question, index + 1))],
      })
      .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message, error })))
    if (state.status === "cancelled") return yield* Effect.die(new Permission.RejectedError({}))
    const answers = input.questions.map((_, index): Question.Answer => {
      const value = state.answer[`q${index}`]
      if (value === undefined) return []
      if (Array.isArray(value)) return [...value]
      return [String(value)]
    })
    return {
      output: { answers },
      content: [{ type: "text" as const, text: toModelContent(input.questions, answers) }],
      metadata: { answers },
    }
  })
}

export function toField(question: Question.Prompt, index: number): Form.Field {
  return {
    key: `q${index}`,
    title: question.header,
    description: question.question,
    type: question.multiple === true ? "multiselect" : "string",
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom: true,
  }
}

export const QuestionToolPlugin = define({
  id: "core.tool.question",
  effect: (context) =>
    Effect.gen(function* () {
      const form = yield* Form.Service
      const tool = {
        ...QuestionTool,
        execute: (input: typeof Input.Type, caller: Tool.Context) =>
          QuestionTool.execute(input, caller).pipe(Effect.provideService(Form.Service, form)),
      } satisfies Tool.Info<typeof Input, typeof Output>
      yield* context.tool.transform((editor) => editor.add(tool))
    }),
})
