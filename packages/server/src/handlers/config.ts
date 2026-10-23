import { Config } from "@bymorning/core/config"
import { Credential } from "@bymorning/core/credential"
import { OutboundMCPSettings } from "@bymorning/core/outbound-mcp-settings"
import { Audit } from "@bymorning/core/audit"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { Plugin } from "@bymorning/core/plugin"
import { Info } from "@bymorning/schema/config"
import { ConfigMCP } from "@bymorning/schema/config/mcp"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { ForbiddenError, InputError } from "@bymorning/protocol/errors"
import { Routing } from "@bymorning/core/routing"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { forbidden } from "../middleware/admin.js"

/**
 * Workspace Config sections that decide where member data flows or what code runs:
 * risky Provider admission, model rewrites, Plugin installation, execution and
 * egress selection, and Workspace-wide activity caps. Members may read the whole
 * document but never change these (NIST 3.1.5 least privilege, 3.1.7 privileged
 * functions). `compaction` stays member-writable; `default_model` and
 * `model_policy` are server-owned and stripped from the payload by Config.update.
 */
const adminSections = [
  ["Plugin configuration", (info: Info) => info.plugins ?? null],
  ["Provider admission", (info: Info) => info.providers?.allow ?? null],
  ["Routing", (info: Info) => info.routing ?? null],
  ["Gateway configuration", (info: Info) => info.gateway ?? null],
  ["Web search selection", (info: Info) => info.websearch ?? null],
  ["Code Interpreter selection", (info: Info) => info.code_interpreter ?? null],
  ["Tool output limits", (info: Info) => info.tool_output ?? null],
  ["default Agent", (info: Info) => info.default_agent ?? null],
] satisfies ReadonlyArray<readonly [section: string, select: (info: Info) => unknown]>

/**
 * Shared MCP header values may be secrets and only Workspace administrators
 * manage them, so every other caller reads them redacted.
 */
const readable = (actor: { readonly type: string; readonly properties: object }) =>
  actor.type === "user" && "role" in actor.properties && actor.properties.role === "admin"

/** Workspace Config endpoint implementations. */
export const ConfigHandler = HttpApiBuilder.group(Api, "api.config", (handlers) =>
  handlers
    .handle("config.get", () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const config = yield* Config.Service
        const info = yield* config.get
        return readable(actor) ? info : ConfigMCP.redact(info)
      }),
    )
    .handle("config.update", ({ payload: submitted }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const config = yield* Config.Service
        const current = yield* config.get
        const entries = yield* config.entries()
        const stored = entries.at(-1)?.info
        // A document read back redacted carries the marker where a header value was hidden;
        // restore the stored value so returning it unchanged is not an edit.
        const payload = ConfigMCP.restore(submitted, stored ?? current)
        const next = yield* Schema.decodeUnknownEffect(Info)(payload).pipe(Effect.orDie)
        if (
          JSON.stringify(current.permissions) !== JSON.stringify(next.permissions) &&
          (actor.type !== "user" || actor.properties.role === "member")
        )
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change permissions" })
        if (
          JSON.stringify(stored?.providers?.activation) !== JSON.stringify(next.providers?.activation) &&
          (actor.type !== "user" || actor.properties.role !== "admin")
        )
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change Provider activation" })
        if (
          JSON.stringify({
            activation: (stored ?? current).mcp?.activation,
            servers: (stored ?? current).mcp?.servers,
          }) !== JSON.stringify({
            activation: next.mcp?.activation,
            servers: next.mcp?.servers,
          }) &&
          (actor.type !== "user" || actor.properties.role !== "admin")
        )
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change MCP activation" })
        if (actor.type !== "user" || actor.properties.role !== "admin") {
          for (const [section, select] of adminSections) {
            if (JSON.stringify(select(current)) !== JSON.stringify(select(next)))
              return yield* new ForbiddenError({
                message: `Only Workspace administrators can change ${section}`,
              })
          }
        }
        if (
          JSON.stringify(current.routing ?? []) !== JSON.stringify(next.routing ?? []) &&
          actor.type === "user" &&
          actor.properties.role === "admin"
        ) {
          const routing = yield* Routing.Service
          yield* routing.check(next.routing ?? []).pipe(
            Effect.mapError(
              (error) =>
                new InputError({
                  error: error.issues.map((issue) => `Routing rule ${issue.rule + 1}: ${issue.message}`).join("; "),
                }),
            ),
          )
        }
        const supervisor = yield* Plugin.Supervisor.Service
        const lease = yield* LLMGateway.Lease.Service
        const sections = [
          ...(JSON.stringify(current.permissions) !== JSON.stringify(next.permissions) ? ["permissions"] : []),
          ...adminSections.flatMap(([section, select]) =>
            JSON.stringify(select(current)) !== JSON.stringify(select(next)) ? [section] : [],
          ),
          ...(JSON.stringify(stored?.providers?.activation) !== JSON.stringify(next.providers?.activation)
            ? ["Provider activation"]
            : []),
          ...(JSON.stringify({
            activation: (stored ?? current).mcp?.activation,
            servers: (stored ?? current).mcp?.servers,
          }) !==
          JSON.stringify({
            activation: next.mcp?.activation,
            servers: next.mcp?.servers,
          })
            ? ["MCP"]
            : []),
        ]
        // Member inventory settles with this document. Workspace drain is ticketed
        // on the retained activation so this response does not wait for Gateway streams.
        // Core re-checks the admin-section rule against this Actor; keep the
        // refusal a protocol 403 rather than a defect if the rules ever diverge.
        // The Entry commits with the Config write (fail-closed), before reload.
        const updated = yield* supervisor.reloadAfter(
          Audit.audited(
            config.update(payload, actor).pipe(Effect.catchTag("Actor.ForbiddenError", forbidden)),
            [
              ...(sections.includes("permissions")
                ? [
                    {
                      actor: Audit.principal(actor),
                      action: "permission.write",
                      workspaceID: actor.properties.workspaceID,
                      target: "permissions",
                      detail: { rules: (next.permissions ?? []).length },
                      outcome: "success",
                    } satisfies Audit.RecordInput,
                  ]
                : []),
              {
                actor: Audit.principal(actor),
                action: "config.update",
                workspaceID: actor.properties.workspaceID,
                detail: { sections: sections.filter((section) => section !== "permissions") },
                outcome: "success",
              } satisfies Audit.RecordInput,
            ],
          ),
        ).pipe(Effect.orDie)
        // Saved member authentication for a removed or moved MCP server is discarded with the change.
        if (sections.includes("MCP"))
          yield* OutboundMCPSettings.prune(yield* Credential.Service, (stored ?? current).mcp, updated.mcp)
        yield* lease.invalidate(actor.properties.workspaceID)
        return readable(actor) ? updated : ConfigMCP.redact(updated)
      }),
    )
    .handle("config.refresh", () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const config = yield* Config.Service
        const supervisor = yield* Plugin.Supervisor.Service
        const lease = yield* LLMGateway.Lease.Service
        const refreshed = yield* supervisor.reloadAfter(config.refresh).pipe(Effect.orDie)
        yield* lease.invalidate(actor.properties.workspaceID)
        return readable(actor) ? refreshed : ConfigMCP.redact(refreshed)
      }),
    ),
)
