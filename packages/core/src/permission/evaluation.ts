import { Permission } from "@bymorning/schema/permission"
import { Wildcard } from "../wildcard.js"

export const match = Wildcard.match

/** Evaluate ordered rules with last matching action/resource rule winning. */
export const evaluate = (
  action: string,
  resource: string,
  ...rulesets: ReadonlyArray<Permission.Ruleset>
): Permission.Rule =>
  rulesets.flat().findLast((rule) => match(action, rule.action) && match(resource, rule.resource)) ?? {
    action,
    resource: "*",
    effect: "allow",
  }

/** Whether catalog visibility is disabled for every resource of an action. */
export const whollyDenied = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}
export * as PermissionEvaluation from "./evaluation.js"
