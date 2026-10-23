import type { FormInfo } from "@bymorning/client"

/** Decode optional server-driven navigation without widening the public Form schema. */
export function formNavigation(form: Pick<FormInfo, "metadata">) {
  const navigation = form.metadata?.navigation
  if (typeof navigation !== "object" || navigation === null || Array.isArray(navigation)) return
  const actionKey = "actionKey" in navigation ? navigation.actionKey : undefined
  const backValue = "backValue" in navigation ? navigation.backValue : undefined
  if (typeof actionKey !== "string" || typeof backValue !== "string") return
  return { actionKey, backValue }
}
