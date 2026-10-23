import { Tool } from "@bymorning/schema/tool"
import type { ToolHook } from "./tool.js"

declare const hook: ToolHook

void hook("execute.before", () => undefined)
void hook("execute.before", () => new Tool.Error({ message: "denied" }))
void hook("execute.before", async () => new Tool.Error({ message: "denied" }))
void hook("execute.after", () => undefined)
