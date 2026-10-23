export * as Judge from "./judge.js"

import type { Model } from "@bymorning/schema/model"
import type { Routing } from "@bymorning/schema/routing"
import type { Digest } from "./digest.js"

/** One judge inference the entrypoint performs and accounts for. */
export interface Request {
  readonly model: Model.Ref
  readonly system: string
  readonly prompt: string
}

/** The judge's raw answer and its priced cost when known. */
export interface Reply {
  readonly text: string
  readonly cost?: number
}

export const defaults = { window: 3, timeout: 3_000 } as const

const historyBudget = 4_000
const askBudget = 8_000

const rubric = [
  "You route requests to the least expensive model tier that will answer them well.",
  "Tiers are listed from least to most capable. Read each tier's description and choose the first tier that fits the request.",
  "Consider the difficulty of the work the request asks for, not its length. A short request can require deep reasoning; a long pasted document can need only a simple answer.",
  'Reply with only a JSON object of the form {"tier": "<name>"} using one of the listed tier names.',
].join("\n")

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit)}...`)

/** Build the judge prompt. Only participant-written turns are shown. */
export const request = (judge: Routing.Judge, tiers: ReadonlyArray<Routing.Tier>, digest: Digest): Request => {
  const window = judge.window ?? defaults.window
  const earlier: string[] = []
  let budget = historyBudget
  for (const text of window === 0 ? [] : digest.history.slice(-window).reverse()) {
    if (budget <= 0) break
    const clipped = clip(text, budget)
    earlier.unshift(clipped)
    budget -= clipped.length
  }
  const prompt = [
    "Tiers:",
    ...tiers.map((tier) => `- ${tier.name}: ${tier.description}`),
    ...(earlier.length === 0
      ? []
      : ["", "Earlier requests in this conversation (context only, do not classify these):", ...earlier.map((text, index) => `[${index + 1}] ${text}`)]),
    "",
    `Conversation size: about ${digest.tokens} tokens.`,
    "",
    "Classify this request:",
    clip(digest.ask, askBudget),
  ].join("\n")
  const instructions = judge.instructions?.trim()
  return {
    model: judge.model,
    system: instructions === undefined || instructions.length === 0 ? rubric : `${rubric}\n\n${instructions}`,
    prompt,
  }
}

/** Read the chosen Tier name, or undefined when the answer names no offered Tier. */
export const parse = (text: string, names: ReadonlySet<string>): string | undefined => {
  const trimmed = text.trim()
  if (names.has(trimmed)) return trimmed
  const object = trimmed.match(/\{[\s\S]*?\}/)
  if (object === null) return undefined
  try {
    const value = JSON.parse(object[0])
    if (typeof value !== "object" || value === null || !("tier" in value)) return undefined
    const tier = (value as { tier: unknown }).tier
    return typeof tier === "string" && names.has(tier) ? tier : undefined
  } catch {
    return undefined
  }
}
