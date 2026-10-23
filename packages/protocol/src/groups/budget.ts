import * as Budget from "@bymorning/schema/budget"
import * as ServiceAccount from "@bymorning/schema/service-account"
import * as User from "@bymorning/schema/user"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** The only place the three Holder kinds are named; the server maps a Target to an opaque Holder. */
export const Target = Schema.Union([
  Schema.Struct({ type: Schema.Literal("workspace") }),
  Schema.Struct({ type: Schema.Literal("user"), userID: User.ID }),
  Schema.Struct({ type: Schema.Literal("service_account"), serviceAccountID: ServiceAccount.ID }),
])
export type Target = typeof Target.Type

/** One Target's current-Period Standing. */
export const TargetStanding = Schema.Struct({ target: Target, ...Budget.Standing.fields })
export interface TargetStanding extends Schema.Schema.Type<typeof TargetStanding> {}

export const Status = Schema.Struct({
  period: Budget.Period,
  standings: Schema.Array(TargetStanding),
})
export interface Status extends Schema.Schema.Type<typeof Status> {}

/** Current-Period Spend Limits and Charges for the Workspace, its members, and its Service Accounts. */
export const BudgetGroup = HttpApiGroup.make("api.budget")
  .add(
    HttpApiEndpoint.get("budget.status", "/budget", {
      query: WorkspaceQuery,
      success: Status,
      error: [InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.put("budget.limit", "/budget/limit", {
      query: WorkspaceQuery,
      /** Omit `amount` to clear the Spend Limit. */
      payload: Schema.Struct({ target: Target, amount: Schema.optionalKey(Budget.Amount) }),
      success: TargetStanding,
      error: [InputError, ForbiddenError, InternalError],
    }),
  )
  .prefix("/api")
