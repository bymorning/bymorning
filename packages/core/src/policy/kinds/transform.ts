import type { Tool } from "@bymorning/schema/tool"
import { compile } from "@bymorning/schema/policy"
import type { Policy } from "../../policy.js"
import { Wildcard } from "../../wildcard.js"

export const toolInput = (
  selected: ReadonlyArray<Policy.Selected<"tool.input">>,
  tool: string,
  input: unknown,
): { readonly message?: string; readonly policyID: string; readonly rule: number } | undefined => {
  for (const item of selected) {
    if (!Wildcard.match(tool, item.definition.tool)) continue
    const regex = compile(item.definition.match)
    if (regex === undefined) continue
    const value = item.definition.path === undefined ? JSON.stringify(input) : pathValue(input, item.definition.path)
    if (value === undefined || !regex.test(value)) continue
    return {
      policyID: item.policyID,
      rule: item.rule,
      ...(item.definition.message === undefined ? {} : { message: item.definition.message }),
    }
  }
  return undefined
}

export const toolOutput = (
  selected: ReadonlyArray<Policy.Selected<"tool.output">>,
  tool: string,
  result: Tool.Result,
): {
  readonly result: Tool.Result
  readonly applied: Array<{ readonly policyID: string; readonly rule: number }>
} => {
  const applied: Array<{ readonly policyID: string; readonly rule: number }> = []
  let transformed = result
  for (const item of selected) {
    if (!Wildcard.match(tool, item.definition.tool)) continue
    const compiled = compile(item.definition.match)
    if (compiled === undefined) continue
    const regex = new RegExp(compiled.source, `${compiled.flags}g`)
    let changed = false
    const content = Array.isArray(transformed.content)
      ? transformed.content.map((part) => {
          if (part.type !== "text") return part
          const text = part.text.replace(regex, item.definition.replacement)
          if (text === part.text) return part
          changed = true
          return { ...part, text }
        })
      : transformed.content
    const output =
      typeof transformed.output === "string"
        ? transformed.output.replace(regex, item.definition.replacement)
        : transformed.output
    if (output !== transformed.output) changed = true
    if (!changed) continue
    transformed = {
      ...transformed,
      ...(content === undefined ? {} : { content }),
      ...(output === undefined ? {} : { output }),
    }
    applied.push({ policyID: item.policyID, rule: item.rule })
  }
  return { result: transformed, applied }
}

export const instructions = (
  selected: ReadonlyArray<Policy.Selected<"instruction">>,
  model: string,
  agent: string,
): Array<{ readonly text: string; readonly policyID: string; readonly rule: number }> =>
  selected.flatMap((item) =>
    Wildcard.match(model, item.definition.model) &&
    (item.definition.agent === undefined || Wildcard.match(agent, item.definition.agent))
      ? [{ text: item.definition.text, policyID: item.policyID, rule: item.rule }]
      : [],
  )

export const prompt = (
  selected: ReadonlyArray<Policy.Selected<"prompt">>,
  text: string,
): {
  readonly text: string
  readonly applied: Array<{ readonly policyID: string; readonly rule: number }>
} => {
  const applied: Array<{ readonly policyID: string; readonly rule: number }> = []
  let transformed = text
  for (const item of selected) {
    const compiled = compile(item.definition.match)
    if (compiled === undefined) continue
    const next = transformed.replace(new RegExp(compiled.source, `${compiled.flags}g`), item.definition.replacement)
    if (next === transformed) continue
    transformed = next
    applied.push({ policyID: item.policyID, rule: item.rule })
  }
  return { text: transformed, applied }
}

const pathValue = (input: unknown, path: string) => {
  let value = input
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null || !(segment in value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined
  return String(value)
}

export * as PolicyTransformKinds from "./transform.js"
