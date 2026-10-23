/** Structured stderr emission of committed Audit Entries and retention summaries. */
import { Audit } from "@bymorning/schema/audit"
import { writeLine } from "@bymorning/observability/logging"
import { Schema } from "effect"

const encode = Schema.encodeSync(Audit.Entry)

/** Emit one committed Entry as a single structured JSON line for the host log pipeline. */
export const writeEntry = (value: Audit.Entry) => writeLine({ type: "audit.entry", ...encode(value) })

/** Emit the retention summary line before the pruner deletes. */
export const writePrune = (input: { readonly deleted: number; readonly cutoff: Date }) =>
  writeLine({ type: "audit.prune", deleted: input.deleted, cutoff: input.cutoff.toISOString() })
