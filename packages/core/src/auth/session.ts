import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database.js"
import { LoginSessionTable } from "../database/schema/auth.sql.js"

/** Activity touches extend the idle bound at most once per minute. */
export const touchThrottleMillis = 60_000

export interface Record {
  readonly id: Auth.SessionID
  readonly accountID: Account.ID
  readonly expiresAt: Date
  readonly idleExpiresAt: Date
  readonly touchedAt: Date
  readonly revokedAt: Date | null
  readonly createdAt: Date
}

const shape = {
  id: LoginSessionTable.id,
  accountID: LoginSessionTable.accountId,
  expiresAt: LoginSessionTable.timeExpires,
  idleExpiresAt: LoginSessionTable.timeIdleExpires,
  touchedAt: LoginSessionTable.timeTouched,
  revokedAt: LoginSessionTable.timeRevoked,
  createdAt: LoginSessionTable.timeCreated,
} as const

/** Insert the durable record for a freshly issued Login Session. */
export const insert = (
  database: Database.Interface,
  input: {
    readonly id: Auth.SessionID
    readonly accountID: Account.ID
    readonly issuedAt: Date
    readonly expiresAt: Date
    readonly idleExpiresAt: Date
  },
) =>
  database.use("Auth.issueSession", (db) =>
    db.insert(LoginSessionTable).values({
      id: input.id,
      accountId: input.accountID,
      timeExpires: input.expiresAt,
      timeIdleExpires: input.idleExpiresAt,
      timeTouched: input.issuedAt,
    }),
  )

/** Load the record addressed by a cookie payload, whatever its state. */
export const find = (database: Database.Interface, id: Auth.SessionID, accountID: Account.ID) =>
  database
    .use("Auth.findSession", (db) =>
      db
        .select(shape)
        .from(LoginSessionTable)
        .where(and(eq(LoginSessionTable.id, id), eq(LoginSessionTable.accountId, accountID)))
        .limit(1),
    )
    .pipe(Effect.map((rows) => rows[0]))

/**
 * Extend the idle bound after activity, clamped to the absolute expiry. The
 * 60-second throttle is applied by the caller from the record it just read.
 */
export const touch = (
  database: Database.Interface,
  id: Auth.SessionID,
  now: Date,
  idleMillis: number,
  absolute: Date,
) =>
  database.use("Auth.touchSession", (db) =>
    db
      .update(LoginSessionTable)
      .set({
        timeTouched: now,
        timeIdleExpires: new Date(Math.min(now.getTime() + idleMillis, absolute.getTime())),
      })
      .where(and(eq(LoginSessionTable.id, id), isNull(LoginSessionTable.timeRevoked))),
  )

/** Revoke one Account-owned session. Returns whether a live record was revoked. */
export const revokeRecord = (database: Database.Interface, id: Auth.SessionID, accountID: Account.ID, now: Date) =>
  database
    .use("Auth.revokeSession", (db) =>
      db
        .update(LoginSessionTable)
        .set({ timeRevoked: now })
        .where(
          and(
            eq(LoginSessionTable.id, id),
            eq(LoginSessionTable.accountId, accountID),
            isNull(LoginSessionTable.timeRevoked),
          ),
        )
        .returning({ id: LoginSessionTable.id }),
    )
    .pipe(Effect.map((rows) => rows.length > 0))

/** Revoke every live session of one Account (suspension and installation administration). */
export const revokeAllRecords = (database: Database.Interface, accountID: Account.ID, now: Date) =>
  database.use("Auth.revokeAllSessions", (db) =>
    db
      .update(LoginSessionTable)
      .set({ timeRevoked: now })
      .where(and(eq(LoginSessionTable.accountId, accountID), isNull(LoginSessionTable.timeRevoked)))
      .returning({ id: LoginSessionTable.id }),
  )

/** Live (unrevoked, unexpired) sessions of one Account, newest first. */
export const listLive = (database: Database.Interface, accountID: Account.ID, now: Date) =>
  database.use("Auth.listSessions", (db) =>
    db
      .select(shape)
      .from(LoginSessionTable)
      .where(
        and(
          eq(LoginSessionTable.accountId, accountID),
          isNull(LoginSessionTable.timeRevoked),
          gt(LoginSessionTable.timeExpires, now),
          gt(LoginSessionTable.timeIdleExpires, now),
        ),
      )
      .orderBy(desc(LoginSessionTable.timeCreated)),
  )
