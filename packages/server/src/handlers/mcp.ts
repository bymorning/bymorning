import { Config } from "@bymorning/core/config"
import { Credential } from "@bymorning/core/credential"
import { Audit } from "@bymorning/core/audit"
import { Mcp } from "@bymorning/core/mcp"
import { OutboundMCPSettings } from "@bymorning/core/outbound-mcp-settings"
import { Integration } from "@bymorning/core/integration"
import { User } from "@bymorning/core/user"
import { ConfigMCP } from "@bymorning/schema/config/mcp"
import { InputError, McpServerNotFoundError } from "@bymorning/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"
import { Plugin } from "@bymorning/core/plugin"
export const McpSettingsHandler = HttpApiBuilder.group(Api, "api.mcp", (handlers) =>
  handlers
    .handle("mcp.tools.list", () =>
      Mcp.Service.use((mcp) => mcp.tools()).pipe(
        Effect.map((tools) =>
          tools.map((tool) => ({
            server: tool.server,
            name: tool.name,
            action: tool.action,
            ...(tool.description === undefined ? {} : { description: tool.description }),
          })),
        ),
      ),
    )
    .handle("mcp.servers.list", () => Mcp.Service.use((mcp) => mcp.servers()))
    .handle("mcp.servers.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const server = yield* normalizeServerName(params.server)
        const mcp = yield* Mcp.Service
        if (!(yield* mcp.servers()).some((item) => item.name === server))
          return yield* new McpServerNotFoundError({ server, message: "MCP server not found" })
        const config = yield* Config.Service
        const supervisor = yield* Plugin.Supervisor.Service
        yield* supervisor
          .reloadAfter(
            Audit.audited(config.mcp.update(server, payload.enabled ? "enabled" : "disabled", actor), {
              actor: Audit.principal(actor),
              action: "mcp.update",
              workspaceID: actor.properties.workspaceID,
              target: server,
              detail: { enabled: payload.enabled },
              outcome: "success",
            }),
          )
          .pipe(Effect.orDie)
        const updated = (yield* mcp.servers()).find((item) => item.name === server)
        if (updated === undefined)
          return yield* new McpServerNotFoundError({ server, message: "MCP server not found" })
        return updated
      }),
    )
    .handle("mcp.servers.put", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const server = yield* normalizeServerName(params.server)
        const config = yield* Config.Service
        const before = (yield* config.get).mcp
        const supervisor = yield* Plugin.Supervisor.Service
        yield* supervisor
          .reloadAfter(
            Audit.audited(
              OutboundMCPSettings.put(config, {
                name: server,
                url: payload.url,
                ...(payload.oauth === undefined ? {} : { oauth: payload.oauth }),
                ...(payload.codemode === undefined ? {} : { codemode: payload.codemode }),
                ...(payload.disabled === undefined ? {} : { disabled: payload.disabled }),
                ...(payload.headers === undefined ? {} : { headers: payload.headers }),
              }, actor).pipe(Effect.mapError((error) => new InputError({ error: error.message }))),
              {
                actor: Audit.principal(actor),
                action: "mcp.update",
                workspaceID: actor.properties.workspaceID,
                target: server,
                // Header names only: shared header values may be secrets.
                detail: {
                  url: payload.url,
                  disabled: payload.disabled ?? false,
                  ...(payload.headers === undefined ? {} : { headers: Object.keys(payload.headers).toSorted() }),
                },
                outcome: "success",
              },
            ),
          )
          // Refused settings are the caller's input error; anything else is a defect.
          .pipe(Effect.catch((error) => (error._tag === "Protocol.InputError" ? Effect.fail(error) : Effect.die(error))))
        yield* OutboundMCPSettings.prune(yield* Credential.Service, before, (yield* config.get).mcp)
      }),
    )
    .handle("mcp.servers.remove", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const server = yield* normalizeServerName(params.server)
        const config = yield* Config.Service
        const before = (yield* config.get).mcp
        if (before?.servers?.[server] === undefined)
          return yield* new McpServerNotFoundError({ server, message: "MCP server not found" })
        const supervisor = yield* Plugin.Supervisor.Service
        yield* supervisor
          .reloadAfter(
            Audit.audited(config.mcp.remove(server, actor), {
              actor: Audit.principal(actor),
              action: "mcp.update",
              workspaceID: actor.properties.workspaceID,
              target: server,
              detail: { removed: true },
              outcome: "success",
            }),
          )
          .pipe(Effect.orDie)
        yield* OutboundMCPSettings.prune(yield* Credential.Service, before, (yield* config.get).mcp)
      }),
    )
    .handle("mcp.servers.members", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const server = yield* normalizeServerName(params.server)
        const settings = yield* Config.Service
        const config = (yield* settings.get).mcp?.servers?.[server]
        if (config === undefined) return yield* new McpServerNotFoundError({ server, message: "MCP server not found" })
        // Only servers whose members supply their own values have anything to report.
        if (!ConfigMCP.personal(config.headers)) return []
        const credentials = yield* Credential.Service
        const held = yield* credentials.connected(Integration.ID.make(Mcp.identity(server, config.url)))
        const updated = new Map(held.map((item) => [item.userID, item.updated]))
        const users = yield* User.Service
        const { members } = yield* users.list(actor)
        return members
          .filter((member) => member.status === "active")
          .map((member) => ({
            userID: member.id,
            email: member.email,
            connected: updated.has(member.id),
            ...(updated.has(member.id) ? { updated: updated.get(member.id)!.toISOString() } : {}),
          }))
          .toSorted((left, right) => left.email.localeCompare(right.email))
      }),
    )
    .handle("mcp.servers.connect", ({ params }) =>
      Effect.gen(function* () {
        const server = yield* normalizeServerName(params.server)
        const mcp = yield* Mcp.Service
        yield* mcp
          .connect(server)
          .pipe(Effect.mapError(() => new McpServerNotFoundError({ server, message: "MCP server not found" })))
      }),
    )
    .handle("mcp.servers.disconnect", ({ params }) =>
      Effect.gen(function* () {
        const server = yield* normalizeServerName(params.server)
        const mcp = yield* Mcp.Service
        yield* mcp
          .disconnect(server)
          .pipe(Effect.mapError(() => new McpServerNotFoundError({ server, message: "MCP server not found" })))
      }),
    )
    .handle("mcp.servers.test", ({ params }) =>
      Effect.gen(function* () {
        const server = yield* normalizeServerName(params.server)
        const mcp = yield* Mcp.Service
        return yield* mcp.test(server).pipe(
          Effect.as({ ok: true }),
          Effect.catchTags({
            "Mcp.NotFoundError": () => new McpServerNotFoundError({ server, message: "MCP server not found" }),
            "Mcp.NeedsAuthError": () => Effect.succeed({ ok: false, error: "Authentication required" }),
            "Mcp.RequestError": (error) => Effect.succeed({ ok: false, error: error.message }),
          }),
        )
      }),
    ),
)

const normalizeServerName = (input: string) => {
  const name = input.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
    ? Effect.succeed(name)
    : Effect.fail(
        new InputError({
          error: "MCP server name must be 1-64 letters, numbers, dots, underscores, or hyphens",
        }),
      )
}
