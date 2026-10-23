import { Actor } from "@bymorning/core/actor"
import { Audit } from "@bymorning/core/audit"
import { Budget } from "@bymorning/core/budget"
import { ServiceAccount } from "@bymorning/core/service-account"
import { User } from "@bymorning/core/user"
import { InternalError } from "@bymorning/protocol/errors"
import type { Target } from "@bymorning/protocol/groups/budget"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import type { Actor as ActorSchema } from "@bymorning/schema/actor"
import type { Budget as BudgetSchema } from "@bymorning/schema/budget"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"
import { audited } from "../middleware/audit.js"

/** The edge alone knows which identity a Target names; Budget receives an opaque Holder. */
const holderOf = (actor: ActorSchema.Caller, target: Target): BudgetSchema.Holder => {
  const workspaceID = actor.properties.workspaceID
  switch (target.type) {
    case "workspace":
      return Actor.holder.workspace(workspaceID)
    case "user":
      return Actor.holder.user(workspaceID, target.userID)
    case "service_account":
      return Actor.holder.serviceAccount(workspaceID, target.serviceAccountID)
  }
}

const unavailable = () => new InternalError({ error: "Budget could not be read" })

/** Every Target the Workspace currently has: itself, its members, and its active Service Accounts. */
const targets = Effect.fn("BudgetHandler.targets")(function* (actor: ActorSchema.Caller) {
  const users = yield* User.Service
  const serviceAccounts = yield* ServiceAccount.Service
  const [members, accounts] = yield* Effect.all([
    actor.type === "user" ? users.list(actor) : Effect.succeed({ members: [] }),
    serviceAccounts.list(actor.properties.workspaceID),
  ])
  return [
    { type: "workspace" as const },
    ...members.members.map((member) => ({ type: "user" as const, userID: member.id })),
    ...accounts
      .filter((account) => account.status === "active")
      .map((account) => ({ type: "service_account" as const, serviceAccountID: account.id })),
  ] satisfies ReadonlyArray<Target>
})

const standings = Effect.fn("BudgetHandler.standings")(function* (
  actor: ActorSchema.Caller,
  selected: ReadonlyArray<Target>,
) {
  const budget = yield* Budget.Service
  const holders = selected.map((target) => holderOf(actor, target))
  const current = yield* budget.status(holders).pipe(Effect.mapError(unavailable))
  return current.map((standing, index) => ({ target: selected[index]!, ...standing }))
})

/** Spend Limit status and editing for the Workspace, its members, and its Service Accounts. */
export const BudgetHandler = HttpApiBuilder.group(Api, "api.budget", (handlers) =>
  handlers
    .handle(
      "budget.status",
      Effect.fn("BudgetHandler.status")(function* () {
        const actor = yield* CurrentActor
        const selected = yield* targets(actor)
        const listed = yield* standings(actor, selected)
        const period = listed[0]?.period ?? Budget.period(new Date())
        return { period, standings: listed }
      }),
    )
    .handle(
      "budget.limit",
      Effect.fn("BudgetHandler.limit")(function* ({ payload }) {
        // Spend Limits restrain every Holder the Workspace implies, so members never set them (NIST 3.1.5).
        const actor = yield* requireAdmin
        const budget = yield* Budget.Service
        const holder = holderOf(actor, payload.target)
        const workspaceID = actor.properties.workspaceID
        yield* audited(
          budget
            .limit({ holder, ...(payload.amount === undefined ? {} : { amount: payload.amount }) })
            .pipe(Effect.mapError(() => new InternalError({ error: "Spend limit could not be saved" }))),
          {
            actor: Audit.principal(actor),
            action: "budget.limit",
            workspaceID,
            target: holder,
            detail: { target: payload.target, ...(payload.amount === undefined ? { removed: true } : { amount: payload.amount }) },
            outcome: "success",
          },
        )
        const [standing] = yield* standings(actor, [payload.target])
        if (standing === undefined) return yield* unavailable()
        return standing
      }),
    ),
)
