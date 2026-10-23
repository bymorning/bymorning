/** Auth Provider configuration and setup authority. */
export * as AuthProvider from "./auth-provider.js"

import { AuthProvider } from "@bymorning/schema/auth-provider"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { crypto } from "@bymorning/util/effect/app-node-platform"
import { Context, Crypto, Effect, Layer, Redacted, Result } from "effect"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Audit } from "./audit.js"
import { Database } from "./database.js"
import { Installation } from "./installation.js"
import { Cipher } from "./cipher.js"
import { admit } from "./auth-provider/discovery.js"
import { AuthProviderStore, toInfoFields } from "./auth-provider/store.js"
import { AuthProviderToken, digest, isDigest, matches } from "./auth-provider/token.js"

export const ID = AuthProvider.ID
export type ID = AuthProvider.ID
export const Info = AuthProvider.Info
export type Info = AuthProvider.Info
export const Create = AuthProvider.Create
export type Create = AuthProvider.Create
export const Seed = AuthProvider.Seed
export type Seed = AuthProvider.Seed
export const Update = AuthProvider.Update
export type Update = AuthProvider.Update
export const Setup = AuthProvider.Setup
export type Setup = AuthProvider.Setup
export const InvalidError = AuthProvider.InvalidError
export type InvalidError = AuthProvider.InvalidError
export const MissingError = AuthProvider.MissingError
export type MissingError = AuthProvider.MissingError
export const ConflictError = AuthProvider.ConflictError
export type ConflictError = AuthProvider.ConflictError
export const DisabledError = AuthProvider.DisabledError
export type DisabledError = AuthProvider.DisabledError
export const DiscoveryError = AuthProvider.DiscoveryError
export type DiscoveryError = AuthProvider.DiscoveryError
export const TokenError = AuthProvider.TokenError
export type TokenError = AuthProvider.TokenError
export const UnavailableError = AuthProvider.UnavailableError
export type UnavailableError = AuthProvider.UnavailableError

/** Enabled Auth Provider including its client secret. */
export interface Active extends Omit<AuthProvider.Info, "status"> {
  readonly status: "enabled"
  readonly clientSecret: Redacted.Redacted<string>
}

/** Installation-wide Auth Provider configuration. */
export interface Interface {
  readonly init: (input?: {
    readonly seed?: AuthProvider.Seed
    /**
     * Operator-supplied setup token (the SETUP_TOKEN environment variable at
     * the composition root). Stored as a hash on first boot and accepted as an
     * override while configured, so operators can rotate recovery access
     * without database access.
     */
    readonly token?: Redacted.Redacted<string>
    /**
     * File that reveals the generated setup token while Setup is pending.
     * Written owner-read-only and removed once the first Auth Provider exists.
     */
    readonly tokenFile?: string
  }) => Effect.Effect<
    void,
    AuthProvider.UnavailableError | AuthProvider.DiscoveryError | AuthProvider.ConflictError | AuthProvider.InvalidError
  >
  readonly list: () => Effect.Effect<ReadonlyArray<AuthProvider.Info>, AuthProvider.UnavailableError>
  readonly get: (
    id: AuthProvider.ID,
  ) => Effect.Effect<AuthProvider.Info, AuthProvider.MissingError | AuthProvider.UnavailableError>
  readonly create: (
    input: AuthProvider.Create,
    /** Edge-derived Audit principal; defaults to the System principal (boot seeding). */
    actor?: Audit.Principal,
  ) => Effect.Effect<
    AuthProvider.Info,
    AuthProvider.ConflictError | AuthProvider.DiscoveryError | AuthProvider.UnavailableError
  >
  readonly update: (
    input: AuthProvider.Update,
    /** Edge-derived Audit principal; defaults to the System principal (boot seeding). */
    actor?: Audit.Principal,
  ) => Effect.Effect<
    AuthProvider.Info,
    AuthProvider.MissingError | AuthProvider.ConflictError | AuthProvider.DiscoveryError | AuthProvider.UnavailableError
  >
  readonly resolve: (input: {
    readonly id: AuthProvider.ID
    readonly revision?: AuthProvider.Revision
  }) => Effect.Effect<
    Active,
    AuthProvider.MissingError | AuthProvider.DisabledError | AuthProvider.ConflictError | AuthProvider.UnavailableError
  >
  readonly inspect: (
    token: Redacted.Redacted<string>,
  ) => Effect.Effect<ReadonlyArray<AuthProvider.Info>, AuthProvider.TokenError | AuthProvider.UnavailableError>
  readonly setup: (
    input: AuthProvider.Setup,
    /** Edge-derived Audit principal; defaults to Anonymous (the setup-token presenter is unauthenticated). */
    actor?: Audit.Principal,
  ) => Effect.Effect<
    AuthProvider.Info,
    | AuthProvider.TokenError
    | AuthProvider.MissingError
    | AuthProvider.ConflictError
    | AuthProvider.DiscoveryError
    | AuthProvider.UnavailableError
  >
}

/** Process-global configuration authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/AuthProvider") {}

const uniqueDomains = (
  domains: readonly [AuthProvider.Domain, ...AuthProvider.Domain[]],
): readonly [AuthProvider.Domain, ...AuthProvider.Domain[]] => {
  const [first, ...rest] = [...new Set(domains)]
  if (first === undefined) return domains
  return [first, ...rest]
}

/** Reveal the setup token through an owner-read-only file instead of the logs. */
const writeTokenFile = (path: string, token: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${token}\n`, { mode: 0o600 })
      // writeFile mode applies only at creation; chmod also repairs an existing loose file.
      await chmod(path, 0o600)
    },
    catch: () =>
      new AuthProvider.UnavailableError({ operation: "init", message: "Unable to write the setup token file" }),
  })

/** Read the currently revealed setup token, if the file still exists. */
const readTokenFile = (path: string) =>
  Effect.tryPromise(() => readFile(path, "utf8")).pipe(
    Effect.map((content) => content.trim()),
    Effect.catch(() => Effect.succeed(undefined as string | undefined)),
  )

/** Remove a previously revealed setup token once Setup has completed. */
const removeTokenFile = (path: string) =>
  Effect.tryPromise(() => rm(path, { force: true })).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Unable to remove the setup token file").pipe(Effect.annotateLogs({ error: String(error) })),
    ),
  )

/** PostgreSQL Auth Provider implementation. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const cryptoService = yield* Crypto.Crypto
    const installation = yield* Installation.Service
    const audit = yield* Audit.Service
    const cipher = yield* Cipher.Service
    const store = AuthProviderStore.make(database, cipher)

    let operatorToken: Redacted.Redacted<string> | undefined

    const requireToken = Effect.fn("AuthProvider.requireToken")(function* (token: Redacted.Redacted<string>) {
      const stored = yield* store.setupToken()
      const storedMatch = stored !== undefined && matches(stored, token)
      const operatorMatch = operatorToken !== undefined && matches(digest(Redacted.value(operatorToken)), token)
      if (!storedMatch && !operatorMatch) {
        return yield* new AuthProvider.TokenError({ message: "Setup token is incorrect" })
      }
    })

    const create = Effect.fn("AuthProvider.create")(function* (input: AuthProvider.Create, actor?: Audit.Principal) {
      const value = { ...input, domains: uniqueDomains(input.domains) }
      yield* admit(value.issuer)
      const existing = yield* store.get(value.id).pipe(Effect.result)
      if (Result.isSuccess(existing)) {
        return yield* new AuthProvider.ConflictError({
          id: value.id,
          reason: "exists",
          message: "Auth Provider already exists",
        })
      }
      if (existing.failure._tag !== "AuthProvider.MissingError") return yield* existing.failure
      // The Entry commits with the insert (fail-closed); discovery runs before
      // this transaction so no network call holds it open.
      yield* database
        .transact(
          Effect.gen(function* () {
            yield* store.insert(value)
            yield* audit.record({
              actor: actor ?? Audit.system(),
              action: "auth-provider.create",
              target: value.id,
              detail: { issuer: value.issuer, domains: value.domains },
              outcome: "success",
            })
          }),
        )
        .pipe(
          Effect.catchTag("Audit.StoreError", () =>
            Effect.fail(new AuthProvider.UnavailableError({ operation: "create", message: "Audit is unavailable" })),
          ),
          Effect.catchTag("SqlError", () =>
            Effect.fail(new AuthProvider.UnavailableError({ operation: "create", message: "Audit is unavailable" })),
          ),
        )
      return AuthProvider.Info.make({
        id: value.id,
        revision: AuthProvider.Revision.make(1),
        displayName: value.displayName,
        kind: value.kind,
        issuer: value.issuer,
        clientID: value.clientID,
        domains: value.domains,
        status: "enabled",
      })
    })

    const init = Effect.fn("AuthProvider.init")(function* (input?: {
      readonly seed?: AuthProvider.Seed
      readonly token?: Redacted.Redacted<string>
      readonly tokenFile?: string
    }) {
      operatorToken = input?.token
      // The setup token is stored as a sha256 digest, never as the token
      // itself. Only a plaintext held by this process — just generated, or a
      // legacy row hashed on this boot — can still be revealed through the
      // owner-read-only file; after a plain restart the existing file remains
      // the reveal while its content still matches the stored digest.
      let plaintext: string | undefined
      let stored = yield* store.setupToken()
      if (stored === undefined) {
        const generated =
          input?.token !== undefined
            ? Redacted.value(input.token)
            : yield* AuthProviderToken.create().pipe(Effect.provideService(Crypto.Crypto, cryptoService))
        yield* store.saveToken(digest(generated))
        const winner = yield* store.setupToken()
        if (winner === undefined)
          return yield* new AuthProvider.UnavailableError({ operation: "init", message: "Setup token was not stored" })
        stored = winner
        // Only the process whose digest won first boot can reveal its token.
        plaintext = input?.token === undefined && stored === digest(generated) ? generated : undefined
      }
      if (!isDigest(stored)) {
        // Legacy plaintext row from before token hashing: hash it in place.
        // The value remains revealable through the setup-token file this boot.
        const hashed = digest(stored)
        if (yield* store.replaceToken(stored, hashed)) {
          plaintext = stored
          stored = hashed
        } else {
          stored = (yield* store.setupToken()) ?? hashed
        }
      }
      let inserted = false
      if (input?.seed !== undefined) {
        const seed = input.seed
        yield* admit(seed.issuer)
        const match = yield* store.find(seed.issuer, seed.clientID)
        if (match === undefined) {
          const created = yield* create({ id: AuthProvider.ID.create(), ...seed })
          inserted = true
          // A seeded first Auth Provider completes Setup: arm bootstrap so the
          // first login becomes the Installation Admin.
          yield* installation.arm
          yield* Effect.log("Auth Provider seeded", { id: created.id })
        }
      }
      const providers = yield* store.list()
      const pending = !inserted && providers.length === 0
      let revealed = false
      if (pending) {
        // The setup token is an installation secret: it is never logged. It
        // comes from the operator when configured, or from an owner-read-only
        // file on the host; the database holds only its digest.
        if (input?.token !== undefined) {
          yield* Effect.log("Auth Provider setup pending. Present the operator-configured setup token at /setup.")
        } else if (input?.tokenFile !== undefined) {
          const tokenFile = input.tokenFile
          if (plaintext === undefined) {
            const current = yield* readTokenFile(tokenFile)
            if (current !== undefined && matches(stored, Redacted.make(current))) {
              revealed = true
              yield* Effect.log(
                `Auth Provider setup pending. Setup token remains revealed owner-read-only at ${tokenFile}; present it at /setup.`,
              )
            } else {
              // The digest cannot be re-revealed and the reveal is gone, so the
              // recovery path would be lost: rotate to a fresh token and reveal it.
              const rotated = yield* AuthProviderToken.create().pipe(Effect.provideService(Crypto.Crypto, cryptoService))
              if (yield* store.replaceToken(stored, digest(rotated))) {
                stored = digest(rotated)
                plaintext = rotated
                yield* Effect.log("Auth Provider setup token rotated: the previous token could no longer be revealed")
              } else {
                stored = (yield* store.setupToken()) ?? stored
              }
            }
          }
          if (!revealed) {
            revealed =
              plaintext !== undefined
                ? yield* writeTokenFile(tokenFile, plaintext).pipe(
                    Effect.as(true),
                    Effect.catch(() =>
                      Effect.logWarning("Unable to write the setup token file", { tokenFile }).pipe(Effect.as(false)),
                    ),
                  )
                : false
            if (revealed) {
              yield* Effect.log(
                `Auth Provider setup pending. Setup token written owner-read-only to ${tokenFile}; present it at /setup.`,
              )
            } else {
              yield* Effect.logWarning(
                "Auth Provider setup pending but the setup token could not be revealed; supply SETUP_TOKEN to complete setup",
                { tokenFile },
              )
            }
          }
        } else {
          yield* Effect.log(
            "Auth Provider setup pending. No setup-token file is configured; supply SETUP_TOKEN to complete setup.",
          )
        }
      }
      // Clear a stale reveal whenever this boot did not write or keep it: Setup
      // is complete, or the operator now supplies the token instead.
      if (!revealed && input?.tokenFile !== undefined) {
        yield* removeTokenFile(input.tokenFile)
      }
    })

    const update = Effect.fn("AuthProvider.update")(function* (input: AuthProvider.Update, actor?: Audit.Principal) {
      const current = yield* store.getActive(input.id)
      if (current.revision !== input.revision) {
        return yield* new AuthProvider.ConflictError({
          id: input.id,
          reason: "revision",
          message: "Auth Provider revision does not match",
        })
      }
      const secret = input.clientSecret ?? Redacted.make(current.clientSecret)
      const enabling = current.status === "disabled" && input.status === "enabled"
      const rotating = input.clientSecret !== undefined
      if (input.status === "enabled" && (enabling || rotating)) yield* admit(current.issuer)
      // The Entry commits with the replace (fail-closed); discovery already ran.
      return yield* database
        .transact(
          Effect.gen(function* () {
            const info = yield* store.replace({ ...input, domains: uniqueDomains(input.domains) }, secret)
            yield* audit.record({
              actor: actor ?? Audit.system(),
              action: "auth-provider.update",
              target: input.id,
              detail: { status: input.status, domains: uniqueDomains(input.domains) },
              outcome: "success",
            })
            return info
          }),
        )
        .pipe(
          Effect.catchTags({
            "Audit.StoreError": () =>
              Effect.fail(new AuthProvider.UnavailableError({ operation: "update", message: "Audit is unavailable" })),
            SqlError: () =>
              Effect.fail(new AuthProvider.UnavailableError({ operation: "update", message: "Audit is unavailable" })),
          }),
        )
    })

    const resolve = Effect.fn("AuthProvider.resolve")(function* (input: {
      readonly id: AuthProvider.ID
      readonly revision?: AuthProvider.Revision
    }) {
      const row = yield* store.getActive(input.id)
      if (row.status !== "enabled") {
        return yield* new AuthProvider.DisabledError({ id: input.id, message: "Auth Provider is disabled" })
      }
      if (input.revision !== undefined && row.revision !== input.revision) {
        return yield* new AuthProvider.ConflictError({
          id: input.id,
          reason: "revision",
          message: "Auth Provider revision does not match",
        })
      }
      const info = AuthProvider.Info.make({
        ...toInfoFields(row),
        status: "enabled",
      })
      return { ...info, status: "enabled" as const, clientSecret: Redacted.make(row.clientSecret) }
    })

    const inspect = Effect.fn("AuthProvider.inspect")(function* (token: Redacted.Redacted<string>) {
      yield* requireToken(token)
      return yield* store.list()
    })

    const setup = Effect.fn("AuthProvider.setup")(function* (input: AuthProvider.Setup, actor?: Audit.Principal) {
      yield* requireToken(input.token)
      const info = input.type === "create" ? yield* create(input.value, actor) : yield* update(input.value, actor)
      // A presented Setup token completes Setup and is the Installation Admin
      // recovery path: arm bootstrap so the next login becomes admin when no
      // admin remains.
      yield* installation.arm
      if (input.type === "create") {
        // Presenting the setup token to register the first Auth Provider ends Setup.
        // A failed append fails the completed setup view (fail-closed); the
        // provider create above already committed with its own Entry.
        yield* audit
          .record({
            actor: actor ?? Audit.anonymous(),
            action: "setup.complete",
            target: info.id,
            detail: { issuer: info.issuer },
            outcome: "success",
          })
          .pipe(
            Effect.catchTag("Audit.StoreError", () =>
              Effect.fail(new AuthProvider.UnavailableError({ operation: "init", message: "Audit is unavailable" })),
            ),
          )
      }
      return info
    })

    return Service.of({
      init,
      list: store.list,
      get: store.get,
      create,
      update,
      resolve,
      inspect,
      setup,
    })
  }),
)

/** Process-global Auth Provider node. */
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Audit.node, crypto, Installation.node, Cipher.node] })
