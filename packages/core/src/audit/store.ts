/** Audit Entry persistence: append, filtered pages, and retention deletion. */
import type { Audit } from "@bymorning/schema/audit"
import type { Account } from "@bymorning/schema/account"
import type { Workspace } from "@bymorning/schema/workspace"
import { and, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database, AuditEntryTable } from "../database.js"

export type Row = typeof AuditEntryTable.$inferSelect

export interface Page {
  readonly workspaceID?: Workspace.ID
  readonly accountID?: Account.ID
  readonly actions?: ReadonlyArray<Audit.Action>
  readonly from?: Date
  readonly to?: Date
  readonly target?: string
  readonly before?: number
  readonly limit: number
}

/** Construct the persistence adapter over the shared Database authority. */
export const make = (database: Database.Interface) => {
  /** Serialize appends inside the ambient transaction so the chain never forks. */
  const lock = database.use("Audit.lock", (db) => db.execute(sql`select pg_advisory_xact_lock(621731921, 20260926)`))

  const lastChain = database.use("Audit.lastChain", (db) =>
    db.select({ chain: AuditEntryTable.chain }).from(AuditEntryTable).orderBy(desc(AuditEntryTable.sequence)).limit(1),
  )

  const insert = (row: Omit<Row, "sequence">) =>
    database.use("Audit.insert", (db) =>
      db.insert(AuditEntryTable).values(row).returning({ sequence: AuditEntryTable.sequence }),
    )

  const page = (input: Page) =>
    database.use("Audit.page", (db) =>
      db
        .select()
        .from(AuditEntryTable)
        .where(
          and(
            input.workspaceID === undefined ? undefined : eq(AuditEntryTable.workspaceId, input.workspaceID),
            input.accountID === undefined ? undefined : eq(AuditEntryTable.accountId, input.accountID),
            input.actions === undefined || input.actions.length === 0
              ? undefined
              : inArray(AuditEntryTable.action, input.actions),
            input.from === undefined ? undefined : gte(AuditEntryTable.occurredAt, input.from),
            input.to === undefined ? undefined : lte(AuditEntryTable.occurredAt, input.to),
            input.target === undefined ? undefined : eq(AuditEntryTable.target, input.target),
            input.before === undefined ? undefined : lt(AuditEntryTable.sequence, input.before),
          ),
        )
        .orderBy(desc(AuditEntryTable.sequence))
        .limit(input.limit + 1),
    )

  const countBefore = (cutoff: Date) =>
    database
      .use("Audit.countBefore", (db) =>
        db.select({ total: count() }).from(AuditEntryTable).where(lt(AuditEntryTable.occurredAt, cutoff)),
      )
      .pipe(Effect.map((rows) => rows[0]?.total ?? 0))

  const deleteBefore = (cutoff: Date) =>
    database.use("Audit.deleteBefore", (db) => db.delete(AuditEntryTable).where(lt(AuditEntryTable.occurredAt, cutoff)))

  return { lock, lastChain, insert, page, countBefore, deleteBefore }
}
