import { createHash } from "node:crypto"
import { Model } from "@bymorning/schema/model"
import { Archive, type Conversion } from "@bymorning/schema/plugin-migration"
import { Definition, type Rule } from "@bymorning/schema/policy"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Option, Schema } from "effect"
import type { Storage } from "../storage.js"
import { compile } from "./migration/compile.js"
import { Wildcard } from "../wildcard.js"

/** Stable identity of the generated, configurable migration contribution. */
export const ID = "bymorning.migrated"

/** Export every retained value before compiling callbacks. Original keys are never removed or rewritten. */
export const archive = Effect.fn("Plugin.archive")(function* (storage: Storage.Interface, workspaceID: Workspace.ID) {
  const retained = storage.scope({ workspaceID, pluginID: "core.policy.managed" })
  const definitions = (yield* retained.scan({ prefix: "policy/" })).entries
  const suppressions = (yield* retained.scan({ prefix: "suppressed/" })).entries
  const snapshot = { definitions, suppressions }
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
  const key = `migration/v1/${hash}`
  const report = definitions.map((entry) => {
    const decoded = Schema.decodeUnknownOption(Definition)(entry.value, { onExcessProperty: "error" })
    if (Option.isNone(decoded)) return { id: entry.key.slice(7), key: entry.key, status: "invalid", message: "Retained JSON does not decode as a legacy definition; exported unchanged. Activation is blocked.", rules: [] }
    const definition = decoded.value
    const rules = definition.rules.map((rule, index) => ({ index, kind: rule.type, ...conversion(rule) }))
    const disabled = definition.enabled === false || suppressions.some((item) => item.key === `suppressed/${definition.id}` && item.value === true)
    const unsupported = rules.some((rule) => rule.status === "unsupported")
    return {
      id: definition.id, key: entry.key,
      status: disabled ? "disabled" : unsupported ? "unsupported" : "converted",
      message: disabled ? "Retained disabled; enabling requires review of unsupported rules." : unsupported ? "Requires explicit replacement before activation; exported unchanged." : "Compiled into direct Session hooks; inactive Tool/escalation rules remain inactive and are listed individually.",
      rules,
    }
  }) as Conversion[]
  for (const entry of suppressions) report.push({
    id: entry.key.slice("suppressed/".length), key: entry.key,
    status: entry.value === true ? "suppressed" : "invalid",
    message: entry.value === true ? "Suppression retained. Model-routing suppressions must be consumed by the routing Plugin; third-party legacy contributors require an explicit replacement." : "Invalid retained suppression; exported unchanged. Activation is blocked.",
    rules: [],
  })
  const output = { version: 1, key, ...snapshot, report } as Archive
  // Content-addressed archives survive repeated activation and concurrent readers without overwriting prior evidence.
  yield* retained.set(key, output)
  return output
})

/** Load an archived replacement Plugin. The Plugin host owns its activation, configuration, and disposal. */
export const load = Effect.fn("Plugin.migration")(function* (storage: Storage.Interface, workspaceID: Workspace.ID) {
  const report = yield* archive(storage, workspaceID)
  const definitions = report.definitions.flatMap((entry) => {
    const definition = Schema.decodeUnknownOption(Definition)(entry.value, { onExcessProperty: "error" })
    return Option.isNone(definition) ? [] : [definition.value]
  })
  return { plugin: compile(definitions, report), report }
})

function conversion(rule: Rule): Pick<Conversion["rules"][number], "status" | "destination"> {
  switch (rule.type) {
    case "prompt": return { status: "converted", destination: "session.prompt" }
    case "instruction": return { status: "converted", destination: "session.context" }
    case "route": return rule.action === "provider.request" || Option.isSome(Schema.decodeUnknownOption(Model.Ref)(parseModel(rule.target)))
      ? { status: "converted", destination: "session.model.request" }
      : { status: "unsupported", destination: "Invalid model route target requires correction." }
    case "endpoint": return { status: "converted", destination: "session.model.request (retained headers stay private; not copied into Plugin options)" }
    case "guardrail": return ["model.request", "provider.request", "model.use", "provider.use"].some((action) => Wildcard.match(action, rule.action))
      ? { status: "converted", destination: "Session request guards and session.model.invoke; last matching allow/deny is preserved. Tool permissions were never enforced here." }
      : { status: "unwired", destination: "No former production enforcement point matched this action; use permanent Permission or explicit Tool hooks." }
    case "tool.input": return { status: "unwired", destination: "Previously unwired; author an explicit Session Tool / MCP before hook." }
    case "tool.output": return { status: "unwired", destination: "Previously unwired; author an explicit Session Tool / MCP after hook." }
    case "escalate": return { status: "unwired", destination: "Previously unwired; author a Session-scoped callback with disposal." }
  }
}

function parseModel(resource: string) {
  const slash = resource.indexOf("/")
  const hash = resource.indexOf("#", slash)
  return { provider: resource.slice(0, slash), id: resource.slice(slash + 1, hash < 0 ? undefined : hash), ...(hash < 0 || resource.slice(hash + 1) === "default" ? {} : { variant: resource.slice(hash + 1) }) }
}
