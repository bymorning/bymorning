import { Tool } from "@bymorning/schema/tool"
import { Effect } from "effect"
import type { GatewayDomain, GatewayToolExecuteAfter, GatewayToolExecuteBefore } from "./gateway.js"

declare const gateway: GatewayDomain

void gateway.hook("tool.execute.before", (event) => {
  event.input = { transformed: true }
  return Effect.fail(new Tool.Error({ message: "denied" }))
})
void gateway.hook("tool.execute.after", () => Effect.void)

export const beforeFields: keyof GatewayToolExecuteBefore = "userID"
export const completedResult: Extract<GatewayToolExecuteAfter, { readonly status: "completed" }>["result"] = {}
export const errorResult: Extract<GatewayToolExecuteAfter, { readonly status: "error" }>["error"] = new Tool.Error({
  message: "failed",
})
export const hasNoSource: "source" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoSession: "sessionID" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoModel: "model" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoMessage: "messageID" extends keyof GatewayToolExecuteBefore ? false : true = true
