export * as AuthProviderStore from "./store.js"

import { AuthProvider } from "@bymorning/schema/auth-provider"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Redacted } from "effect"
import { Cipher } from "../cipher.js"
import { AuthProviderTable, Database, InstallationSetupTable } from "../database.js"

const singleton = "installation"

const unavailable = (operation: AuthProvider.UnavailableError["operation"]) =>
  new AuthProvider.UnavailableError({ operation, message: "Auth Provider persistence is unavailable" })

/** Map a stored row to secret-free Info fields, including a non-empty domain list. */
export const toInfoFields = (row: typeof AuthProviderTable.$inferSelect) => {
  const [first, ...rest] = row.domains
  if (first === undefined) throw new Error("Auth Provider domains are empty")
  return {
    id: row.id,
    revision: row.revision,
    displayName: row.displayName,
    kind: row.kind,
    issuer: row.issuer,
    clientID: row.client_id,
    domains: [first, ...rest] as const,
    status: row.status,
  }
}

const toInfo = (row: typeof AuthProviderTable.$inferSelect): AuthProvider.Info =>
  AuthProvider.Info.make(toInfoFields(row))

/** Persist Auth Providers and the installation setup token. */
export const make = (database: Database.Interface, cipher: Cipher.Interface) => {
  /** client_secret is a Cipher envelope at rest; legacy plaintext reads through. */
  const decryptSecret = Effect.fnUntraced(function* (value: string) {
    return yield* cipher.decrypt(value).pipe(
      Effect.mapError(() => unavailable("resolve")),
      Effect.map(Redacted.value),
    )
  })

  const list = Effect.fn("AuthProvider.store.list")(function* () {
    const rows = yield* database
      .use("AuthProvider.list", (db) =>
        db.select().from(AuthProviderTable).orderBy(asc(AuthProviderTable.id)).pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("list")))
    return rows.map(toInfo)
  })

  const get = Effect.fn("AuthProvider.store.get")(function* (id: AuthProvider.ID) {
    const row = (yield* database
      .use("AuthProvider.get", (db) =>
        db.select().from(AuthProviderTable).where(eq(AuthProviderTable.id, id)).limit(1).pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("get"))))[0]
    if (row === undefined) {
      return yield* new AuthProvider.MissingError({ id, message: "Auth Provider not found" })
    }
    return toInfo(row)
  })

  const getActive = Effect.fn("AuthProvider.store.active")(function* (id: AuthProvider.ID) {
    const row = (yield* database
      .use("AuthProvider.active", (db) =>
        db.select().from(AuthProviderTable).where(eq(AuthProviderTable.id, id)).limit(1).pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("resolve"))))[0]
    if (row === undefined) {
      return yield* new AuthProvider.MissingError({ id, message: "Auth Provider not found" })
    }
    return { ...row, clientSecret: yield* decryptSecret(row.client_secret) }
  })

  const find = Effect.fn("AuthProvider.store.find")(function* (issuer: AuthProvider.Issuer, clientID: string) {
    const row = (yield* database
      .use("AuthProvider.find", (db) =>
        db
          .select()
          .from(AuthProviderTable)
          .where(and(eq(AuthProviderTable.issuer, issuer), eq(AuthProviderTable.client_id, clientID)))
          .limit(1)
          .pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("init"))))[0]
    return row === undefined ? undefined : toInfo(row)
  })

  const insert = Effect.fn("AuthProvider.store.insert")(function* (input: AuthProvider.Create) {
    const clientSecret = yield* cipher.encrypt(input.clientSecret).pipe(Effect.mapError(() => unavailable("create")))
    yield* database
      .use("AuthProvider.insert", (db) =>
        db
          .insert(AuthProviderTable)
          .values({
            id: input.id,
            revision: AuthProvider.Revision.make(1),
            displayName: input.displayName,
            kind: input.kind,
            issuer: input.issuer,
            client_id: input.clientID,
            client_secret: clientSecret,
            domains: input.domains,
            status: "enabled",
          })
          .pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("create")))
  })

  const replace = Effect.fn("AuthProvider.store.replace")(function* (
    input: AuthProvider.Update,
    secret: Redacted.Redacted<string>,
  ) {
    const clientSecret = yield* cipher.encrypt(secret).pipe(Effect.mapError(() => unavailable("update")))
    const updated = yield* database
      .use("AuthProvider.replace", (db) =>
        db
          .update(AuthProviderTable)
          .set({
            revision: AuthProvider.Revision.make(input.revision + 1),
            displayName: input.displayName,
            kind: input.kind,
            domains: input.domains,
            status: input.status,
            client_secret: clientSecret,
          })
          .where(eq(AuthProviderTable.id, input.id))
          .returning()
          .pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("update")))
    const row = updated[0]
    if (row === undefined) {
      return yield* new AuthProvider.MissingError({ id: input.id, message: "Auth Provider not found" })
    }
    return toInfo(row)
  })

  const setupToken = Effect.fn("AuthProvider.store.setupToken")(function* () {
    const row = (yield* database
      .use("AuthProvider.setupToken", (db) =>
        db
          .select()
          .from(InstallationSetupTable)
          .where(eq(InstallationSetupTable.id, singleton))
          .limit(1)
          .pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("init"))))[0]
    return row?.token
  })

  const saveToken = Effect.fn("AuthProvider.store.saveToken")(function* (token: string) {
    yield* database
      .use("AuthProvider.saveToken", (db) =>
        db.insert(InstallationSetupTable).values({ id: singleton, token }).onConflictDoNothing().pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("init")))
  })

  /** Replace the stored token only while it still holds the expected value. */
  const replaceToken = Effect.fn("AuthProvider.store.replaceToken")(function* (expected: string, token: string) {
    const updated = yield* database
      .use("AuthProvider.replaceToken", (db) =>
        db
          .update(InstallationSetupTable)
          .set({ token })
          .where(and(eq(InstallationSetupTable.id, singleton), eq(InstallationSetupTable.token, expected)))
          .returning({ id: InstallationSetupTable.id })
          .pipe(Effect.orDie),
      )
      .pipe(Effect.mapError(() => unavailable("init")))
    return updated.length === 1
  })

  return { list, get, getActive, find, insert, replace, setupToken, saveToken, replaceToken }
}
