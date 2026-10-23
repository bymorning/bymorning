export * as Tier from "./tier.js"

import type { Model } from "@bymorning/schema/model"
import type { Routing } from "@bymorning/schema/routing"
import type { Digest } from "./digest.js"

/** Headroom kept below a Model's context window before a Tier is considered too small. */
const headroom = 0.95

/**
 * Whether a Tier's Model can serve this request by its known metadata.
 * Missing limits and capabilities are unknown, not refusals.
 */
export const fits = (info: Model.Info, digest: Digest | undefined) => {
  if (digest === undefined) return true
  if (digest.images && info.capabilities.input.length > 0 && !info.capabilities.input.includes("image")) return false
  const context = info.limit.context
  return context === undefined || context === 0 || digest.tokens <= context * headroom
}

/**
 * The Tier to use when the configured default cannot run: the next more capable runnable Tier,
 * otherwise the most capable runnable Tier below it.
 */
export const substitute = (
  tiers: ReadonlyArray<Routing.Tier>,
  runnable: ReadonlySet<string>,
  preferred: string,
): Routing.Tier | undefined => {
  const index = Math.max(
    0,
    tiers.findIndex((tier) => tier.name === preferred),
  )
  return (
    tiers.slice(index).find((tier) => runnable.has(tier.name)) ??
    tiers.slice(0, index).findLast((tier) => runnable.has(tier.name))
  )
}
