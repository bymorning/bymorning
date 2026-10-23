import * as Account from "@bymorning/schema/account"
import { Installation } from "@bymorning/schema/installation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError, ServiceUnavailableError } from "../errors.js"

/** Wire view of whether the authenticated Account holds an Installation Admin grant. */
export const Self = Schema.Struct({
  admin: Schema.Boolean,
}).annotate({ identifier: "Installation.Self" })
export type Self = typeof Self.Type

/** Installation Admin grant input: the Account receiving the grant. */
export const GrantInput = Schema.Struct({
  accountID: Account.ID,
}).annotate({ identifier: "Installation.GrantInput" })
export type GrantInput = typeof GrantInput.Type

/** Installation Admin list projection: granted Account identities, oldest grant first. */
export const AdminList = Schema.Struct({
  admins: Schema.Array(Account.ID),
}).annotate({ identifier: "Installation.AdminList" })
export type AdminList = typeof AdminList.Type

/**
 * Account-authenticated Installation governance contracts. Every mutation
 * requires an Installation Admin grant; `installation.self` answers the
 * caller's own grant without requiring one.
 */
export const InstallationGroup = HttpApiGroup.make("api.installation")
  .add(
    HttpApiEndpoint.get("installation.self", "/installation/self", {
      success: Self,
      error: [ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.get("installation.admin.list", "/installation/admin", {
      success: AdminList,
      error: [ForbiddenError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.post("installation.admin.grant", "/installation/admin", {
      payload: GrantInput,
      success: AdminList.pipe(HttpApiSchema.status(201)),
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("installation.admin.revoke", "/installation/admin/:accountID", {
      params: { accountID: Account.ID },
      success: AdminList,
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("installation.policy.get", "/installation/policy", {
      success: Installation.Policy,
      error: [ForbiddenError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.put("installation.policy.update", "/installation/policy", {
      payload: Installation.Policy,
      success: Installation.Policy,
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .prefix("/api")
