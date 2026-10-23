import { Audit } from "@bymorning/core/audit"
import { InternalError } from "@bymorning/protocol/errors"
import { Effect } from "effect"

/**
 * Run a security-relevant mutation with its Audit Entry (or Entries) in one
 * transaction. The append is fail-closed: a store failure rolls the mutation
 * back and the caller receives a 500 instead of an unaudited change.
 */
export const audited = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
  input:
    | Audit.RecordInput
    | ReadonlyArray<Audit.RecordInput>
    | ((value: A) => Audit.RecordInput | ReadonlyArray<Audit.RecordInput>),
) =>
  Audit.audited(operation, input).pipe(
    Effect.catchTag("Audit.StoreError", () => Effect.fail(new InternalError({ error: "Audit is unavailable" }))),
    Effect.catchTag("SqlError", () => Effect.fail(new InternalError({ error: "Audit is unavailable" }))),
  )
