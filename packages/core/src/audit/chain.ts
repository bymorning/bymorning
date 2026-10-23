/** Tamper-evidence hash chain over the append-only Audit Entry stream. */
import type { Audit } from "@bymorning/schema/audit"
import { createHash } from "node:crypto"

/** Chain value seed for the first Entry in the stream. */
export const genesis = "audit-genesis"

/** The Entry content covered by its tamper-evidence digest. */
export interface Fields {
  readonly id: string
  readonly occurredAt: string
  readonly actor: Audit.Principal
  readonly action: Audit.Action
  readonly workspaceID?: string | null
  readonly target?: string | null
  readonly detail?: Record<string, unknown> | null
  readonly outcome: Audit.Outcome
  readonly context?: Audit.Context | null
}

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return null
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalize)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

/** The covered content with every key present; absent optional fields normalize to null. */
const covered = (entry: Fields) => ({
  id: entry.id,
  occurredAt: entry.occurredAt,
  actor: entry.actor,
  action: entry.action,
  workspaceID: entry.workspaceID ?? null,
  target: entry.target ?? null,
  detail: entry.detail ?? null,
  outcome: entry.outcome,
  context: entry.context ?? null,
})

/** Canonical JSON encoding of the covered content: every covered key, sorted, undefined as null. */
export const canonical = (entry: Fields): string => JSON.stringify(canonicalize(covered(entry)))

/**
 * Normalize a JSON-bound value to its canonical storage form: sorted keys and
 * `undefined` as null. Storing this form keeps the persisted JSON identical to
 * the digested content.
 */
export const normalize = <A>(value: A): A => canonicalize(value) as A

/** Compute one Entry's chain digest from the previous Entry's chain (or genesis) and its covered content. */
export const digest = (previous: string | null, entry: Fields): string =>
  createHash("sha256")
    .update(`${previous ?? genesis}\n${canonical(entry)}`, "utf8")
    .digest("hex")

export interface Chained extends Fields {
  readonly chain: string
}

/**
 * Verify one ascending run of Entries against genesis. Returns the sequence of
 * the first Entry whose digest does not match, or `undefined` when intact.
 * Verification is meaningful from the stream start: a window starting mid-chain
 * reports its first Entry.
 */
export const verifyChain = (entries: ReadonlyArray<Chained & { readonly sequence: number }>): number | undefined => {
  let previous = null as string | null
  for (const entry of entries) {
    if (digest(previous, entry) !== entry.chain) return entry.sequence
    previous = entry.chain
  }
  return undefined
}
