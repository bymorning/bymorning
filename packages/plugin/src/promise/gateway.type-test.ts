import { Tool } from "@bymorning/schema/tool"
import type { GatewayHook, GatewayToolExecuteAfter, GatewayToolExecuteBefore } from "./gateway.js"

declare const hook: GatewayHook

void hook("tool.execute.before", (event) => {
  event.input = { transformed: true }
})
void hook("tool.execute.before", () => new Tool.Error({ message: "denied" }))
void hook("tool.execute.after", () => undefined)

export const beforeFields: keyof GatewayToolExecuteBefore = "userID"
export const completedResult: Extract<GatewayToolExecuteAfter, { readonly status: "completed" }>["result"] = {}
export const errorResult: Extract<GatewayToolExecuteAfter, { readonly status: "error" }>["error"] = new Tool.Error({
  message: "failed",
})
export const hasNoSource: "source" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoSession: "sessionID" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoModel: "model" extends keyof GatewayToolExecuteBefore ? false : true = true
export const hasNoMessage: "messageID" extends keyof GatewayToolExecuteBefore ? false : true = true
