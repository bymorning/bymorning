import type { Usage as ProviderUsage } from "@opencode-ai/ai/schema/events"
import type { Cost } from "@bymorning/schema/model"
import { Usage } from "@bymorning/schema/usage"
import { Array, Option } from "effect"

/** Maximum cumulative estimated Session cost representable in persistence. */
export const maximumCost = 999_999_999_999_999

/** Normalize one completed provider observation and price its immutable catalog snapshot. */
export const normalize = (provider: ProviderUsage | undefined, pricing: Cost): Usage => {
  const inputValue = provider?.nonCachedInputTokens ?? provider?.inputTokens
  const input =
    inputValue === undefined || !Number.isFinite(inputValue) || inputValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(inputValue))
  const reasoningValue = provider?.reasoningTokens
  const reasoning =
    reasoningValue === undefined || !Number.isFinite(reasoningValue) || reasoningValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(reasoningValue))
  const outputValue = provider?.visibleOutputTokens
  const output =
    outputValue === undefined || !Number.isFinite(outputValue) || outputValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(outputValue))
  const readValue = provider?.cacheReadInputTokens
  const read =
    readValue === undefined || !Number.isFinite(readValue) || readValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(readValue))
  const writeValue = provider?.cacheWriteInputTokens
  const write =
    writeValue === undefined || !Number.isFinite(writeValue) || writeValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(writeValue))
  const contextValue = provider?.inputTokens
  const context =
    contextValue === undefined || !Number.isFinite(contextValue) || contextValue < 0
      ? 0
      : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(contextValue))
  const selected = Array.head(
    pricing.tiers
      ?.filter((item) => context > item.tier.size)
      .toSorted((left, right) => right.tier.size - left.tier.size) ?? [],
  ).pipe(
    Option.getOrElse(() =>
      pricing.experimentalOver200K !== undefined && context > 200_000 ? pricing.experimentalOver200K : pricing,
    ),
  )
  const estimate =
    input * (selected.input ?? 0) +
    Math.min(Number.MAX_SAFE_INTEGER, output + reasoning) * (selected.output ?? 0) +
    read * (selected.cache.read ?? 0) +
    write * (selected.cache.write ?? 0)
  return Usage.make({
    cost: Number.isFinite(estimate) ? Math.min(maximumCost, estimate / 1_000_000) : maximumCost,
    costComplete:
      (input === 0 || selected.input !== undefined) &&
      (output + reasoning === 0 || selected.output !== undefined) &&
      (read === 0 || selected.cache.read !== undefined) &&
      (write === 0 || selected.cache.write !== undefined),
    tokens: {
      ...(provider?.totalTokens === undefined
        ? {}
        : {
            total:
              !Number.isFinite(provider.totalTokens) || provider.totalTokens < 0
                ? 0
                : Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(provider.totalTokens)),
          }),
      input,
      output,
      reasoning,
      cache: { read, write },
    },
  })
}

/** Add one immutable Step usage observation to accumulated usage. */
export const add = (left: Usage, right: Usage): Usage => ({
  cost: Math.min(maximumCost, Number.isFinite(left.cost + right.cost) ? left.cost + right.cost : maximumCost),
  costComplete: left.costComplete && right.costComplete,
  tokens: {
    ...(left.tokens.total === undefined && right.tokens.total === undefined
      ? {}
      : { total: Math.min(Number.MAX_SAFE_INTEGER, (left.tokens.total ?? 0) + (right.tokens.total ?? 0)) }),
    input: Math.min(Number.MAX_SAFE_INTEGER, left.tokens.input + right.tokens.input),
    output: Math.min(Number.MAX_SAFE_INTEGER, left.tokens.output + right.tokens.output),
    reasoning: Math.min(Number.MAX_SAFE_INTEGER, left.tokens.reasoning + right.tokens.reasoning),
    cache: {
      read: Math.min(Number.MAX_SAFE_INTEGER, left.tokens.cache.read + right.tokens.cache.read),
      write: Math.min(Number.MAX_SAFE_INTEGER, left.tokens.cache.write + right.tokens.cache.write),
    },
  },
})
