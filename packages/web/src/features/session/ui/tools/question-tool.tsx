import { createMemo, For, Show, type JSX } from "solid-js"

import { useI18n } from "../../../../ui/context/i18n"
import { BasicTool, GenericTool } from "../basic-tool"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import "./question-tool.css"

interface Entry {
  readonly question: string | undefined
  readonly answers: ReadonlyArray<string>
}

function QuestionTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const entries = createMemo(() => (props.tool.state.type === "succeeded" ? summarize(props.tool) : undefined))
  return (
    <Show
      when={entries()}
      fallback={
        <GenericTool
          tool={props.tool}
          {...(props.open === undefined ? {} : { open: props.open })}
          {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
          {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
        />
      }
    >
      {(items) => (
        <BasicTool
          tool={props.tool.name}
          title={`${i18n.t("ui.tool.called")} ${props.tool.name}`}
          status="succeeded"
          {...(props.open === undefined ? {} : { open: props.open })}
          {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
          {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
        >
          <dl data-component="question-answers">
            <For each={items()}>
              {(entry, index) => (
                <div data-slot="question-answer">
                  <dt>{entry.question ?? `${index() + 1}`}</dt>
                  <dd>{entry.answers.length > 0 ? entry.answers.join(", ") : i18n.t("ui.tool.unanswered")}</dd>
                </div>
              )}
            </For>
          </dl>
        </BasicTool>
      )}
    </Show>
  )
}

/** Pairs each recorded answer with the question text from the call input, when the input carries it. */
function summarize(tool: ToolRendererProps["tool"]): ReadonlyArray<Entry> | undefined {
  if (tool.state.type !== "succeeded") return undefined
  const answers = answersOf(tool.state.result) ?? answersOf(parse(tool.state.output))
  if (!answers) return undefined
  const questions = Array.isArray(tool.input.questions) ? tool.input.questions : []
  return answers.map((values, index) => {
    const question: unknown = questions[index]
    const text = question && typeof question === "object" ? Reflect.get(question, "question") : undefined
    return { question: typeof text === "string" && text.length > 0 ? text : undefined, answers: values }
  })
}

function answersOf(value: unknown): ReadonlyArray<ReadonlyArray<string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const answers: unknown = Reflect.get(value, "answers")
  if (!Array.isArray(answers)) return undefined
  const result: Array<ReadonlyArray<string>> = []
  for (const entry of answers) {
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === "string")) return undefined
    result.push(entry)
  }
  return result
}

function parse(output: string | undefined): unknown {
  if (output === undefined) return undefined
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

ToolRegistry.register({ name: "question", render: QuestionTool })
