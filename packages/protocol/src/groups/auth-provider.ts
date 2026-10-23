import * as AuthProvider from "@bymorning/schema/auth-provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError } from "../errors.js"

/**
 * Wire spelling of an Auth Provider issuer. The exact HTTPS spelling is
 * validated against `AuthProvider.Issuer` in Core.
 */
export const Issuer = Schema.String

/**
 * Wire spelling of an Auth Provider email domain. Normalization is validated
 * against `AuthProvider.Domain` in Core.
 */
export const Domain = Schema.String

const editable = {
  displayName: Schema.NonEmptyString,
  kind: AuthProvider.Kind,
  domains: Schema.NonEmptyArray(Domain),
}

/**
 * Transport projection of `AuthProvider.Info`. Secrets never appear on the
 * wire; the stored secret is replaced through `Update`.
 */
export const Info = Schema.Struct({
  id: AuthProvider.ID,
  revision: AuthProvider.Revision,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  status: AuthProvider.Status,
}).annotate({ identifier: "AuthProvider.Info" })
export type Info = typeof Info.Type

/** Transport projection of `AuthProvider.Create`; the secret travels as a plain string. */
export const Create = Schema.Struct({
  id: AuthProvider.ID,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
}).annotate({ identifier: "AuthProvider.Create" })
export type Create = typeof Create.Type

/**
 * Transport projection of `AuthProvider.Update`; an omitted secret retains
 * the stored value.
 */
export const Update = Schema.Struct({
  id: AuthProvider.ID,
  revision: AuthProvider.Revision,
  ...editable,
  status: AuthProvider.Status,
  clientSecret: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "AuthProvider.Update" })
export type Update = typeof Update.Type

/** Transport projection of `AuthProvider.Setup`; the token travels as a plain string. */
export const Setup = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("create"),
    token: Schema.NonEmptyString,
    value: Create,
  }),
  Schema.Struct({
    type: Schema.Literal("update"),
    token: Schema.NonEmptyString,
    value: Update,
  }),
]).annotate({ identifier: "AuthProvider.Setup" })
export type Setup = typeof Setup.Type

/** Account-authenticated Auth Provider configuration contracts; mutations require an Installation Admin. */
export const AuthProviderGroup = HttpApiGroup.make("api.auth-provider")
  .add(
    HttpApiEndpoint.get("authProvider.list", "/auth-provider", {
      success: Schema.Array(Info),
      error: [ForbiddenError, InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("authProvider.create", "/auth-provider", {
      payload: Create,
      success: Info.pipe(HttpApiSchema.status(201)),
      error: [ForbiddenError, InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("authProvider.get", "/auth-provider/:providerID", {
      params: { providerID: AuthProvider.ID },
      success: Info,
      error: [ForbiddenError, InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.put("authProvider.update", "/auth-provider/:providerID", {
      params: { providerID: AuthProvider.ID },
      payload: Update,
      success: Info,
      error: [ForbiddenError, InputError, InternalError],
    }),
  )
  .prefix("/api")
