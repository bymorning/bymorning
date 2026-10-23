/** Toolkit Integration OAuth Tools. */
import type { Context } from "@bymorning/plugin/effect/plugin"
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { Integration } from "@bymorning/schema/integration"
import { Clock, Effect, Schema } from "effect"
import { Actor } from "../../../actor.js"
import { Tool } from "../../../tool.js"
import { IntegrationNamespace, operational } from "./toolkit-shared.js"

const ConnectInput = Schema.Struct({
  integrationID: Schema.String,
  methodID: Schema.String,
  answer: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  label: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.Literals(["member", "workspace"])),
})
const StatusInput = Schema.Struct({
  integrationID: Schema.String,
  attemptID: Schema.optionalKey(Schema.String),
})

const IntegrationConnected = Schema.Struct({
  status: Schema.Literal("connected"),
  integration: Integration.Info,
  connection: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("credential"),
      id: Schema.String,
      label: Schema.String,
      scope: Schema.optionalKey(Schema.Literals(["member", "workspace"])),
      active: Schema.optionalKey(Schema.Boolean),
    }),
    Schema.Struct({ type: Schema.Literal("env"), name: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("regional-credential"),
      id: Schema.String,
      label: Schema.String,
      scope: Schema.optionalKey(Schema.Literals(["member", "workspace"])),
      active: Schema.optionalKey(Schema.Boolean),
      authKind: Schema.Literals(["bearer", "sigv4"]),
      region: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("regional-env"),
      authKind: Schema.Literals(["bearer", "sigv4"]),
      region: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("regional-deployment"),
      authKind: Schema.Literal("sigv4"),
      region: Schema.String,
    }),
  ]).pipe(Schema.toTaggedUnion("type")),
})
const IntegrationAuthorization = Schema.Struct({
  status: Schema.Literal("authorization"),
  integration: Integration.Info,
  attempt: Integration.Attempt,
})
const IntegrationConnect = Schema.Union([IntegrationConnected, IntegrationAuthorization]).pipe(
  Schema.toTaggedUnion("status"),
)
const IntegrationStatus = Schema.Struct({
  integration: Integration.Info,
  attempt: Schema.optionalKey(Integration.AttemptStatus),
})
/** One authentication method, reduced to what a model needs to choose it: identity, kind, and OAuth client readiness. */
const IntegrationMethodRow = Schema.Struct({
  id: Schema.optionalKey(Integration.MethodID),
  type: Schema.Literals(["oauth", "command", "key", "env", "aws-sigv4", "env-group", "values"]),
  label: Schema.optionalKey(Schema.String),
  /** Present only for OAuth methods that need a Workspace-administrator client configuration. */
  configured: Schema.optionalKey(Schema.Boolean),
})
const IntegrationRow = Schema.Struct({
  id: Integration.ID,
  name: Schema.String,
  connectionPolicy: Schema.optionalKey(Integration.ConnectionPolicy),
  methods: Schema.Array(IntegrationMethodRow),
  /** Whether the calling member currently has an active Connection for this Integration. */
  connected: Schema.Boolean,
})
const IntegrationList = Schema.Struct({ integrations: Schema.Array(IntegrationRow) })

const methodRow = (method: Integration.MethodInfo): typeof IntegrationMethodRow.Type => ({
  ...("id" in method ? { id: method.id } : {}),
  type: method.type,
  ...("label" in method && method.label !== undefined ? { label: method.label } : {}),
  ...(method.type === "oauth" && method.client !== undefined ? { configured: method.client.configured } : {}),
})

export const registerIntegrationTools = (
  editor: ToolEditor,
  host: Pick<Context, "integration">,
) => {
  const { integration } = host

  editor.namespace({
    name: IntegrationNamespace,
    description:
      "Use when the user wants to list available Integrations, start OAuth authorization for one, or inspect secret-free connection status.",
  })
  editor.add({
    name: "list",
    description:
      "Use before authoring an Integration or when the user wants to connect a service: every registered Integration with its methods, whether each OAuth method's client is configured by a Workspace administrator, and whether the current member is connected.",
    input: Schema.Struct({}),
    output: IntegrationList,
    options: { ...operational("integration_list", IntegrationNamespace) },
    execute: (_input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "integration_list", resources: ["integration"] })
        const infos = yield* integration
          .list()
          .pipe(Effect.mapError(() => new Tool.Error({ message: "Integrations are unavailable" })))
        const integrations = yield* Effect.forEach(infos, (info) =>
          integration.connection.active(info.id).pipe(
            Effect.map((active) => ({
              id: info.id,
              name: info.name,
              ...(info.connectionPolicy === undefined ? {} : { connectionPolicy: info.connectionPolicy }),
              methods: info.methods.map(methodRow),
              connected: active !== undefined,
            })),
          ),
        )
        return { output: { integrations } }
      }),
  })
  editor.add({
    name: "connect",
    description:
      "Use when the user wants to start OAuth authorization for an Integration without waiting for its browser callback.",
    input: ConnectInput,
    output: IntegrationConnect,
    options: { ...operational("integration_connect", IntegrationNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        if (input.integrationID === "" || input.methodID === "")
          return yield* new Tool.Error({ message: "integrationID and methodID are required" })
        yield* toolContext.permission({ action: "integration_connect", resources: [input.integrationID] })
        const integrationID = Integration.ID.make(input.integrationID)
        const methodID = Integration.MethodID.make(input.methodID)
        const info = yield* integration
          .get({ integrationID })
          .pipe(Effect.mapError(() => new Tool.Error({ message: "Integration is unavailable" })))
        const method = info?.methods.find((item) => item.type === "oauth" && item.id === input.methodID)
        if (!info || !method)
          return yield* new Tool.Error({ message: "This Integration method does not support OAuth authorization" })
        const active =
          input.scope === undefined
            ? yield* integration.connection.active(integrationID)
            : info.connections.find(
                (connection) =>
                  (connection.type === "credential" || connection.type === "regional-credential") &&
                  connection.scope === input.scope,
              )
        if (active) {
          const credential = yield* integration.connection
            .resolve(active)
            .pipe(Effect.orElseSucceed(() => undefined))
          const now = yield* Clock.currentTimeMillis
          if (
            credential?.type === "oauth" &&
            credential.methodID === input.methodID &&
            (credential.expires === 0 || credential.expires > now)
          )
            return { output: { status: "connected", integration: info, connection: active } }
        }
        const attempt = yield* integration.oauth
          .connect({
            integrationID,
            methodID,
            ...(input.answer === undefined ? {} : { answer: input.answer as never }),
            ...(input.label === undefined ? {} : { label: input.label }),
            scope: input.scope ?? "member",
          })
          .pipe(
            Effect.mapError((error) =>
              error instanceof Actor.ForbiddenError
                ? new Tool.Error({ message: error.message })
                : new Tool.Error({ message: "Unable to start Integration OAuth authorization" }),
            ),
          )
        return { output: { status: "authorization", integration: info, attempt } }
      }),
  })
  editor.add({
    name: "status",
    description:
      "Use when the user wants an Integration's secret-free information and optional OAuth attempt status.",
    input: StatusInput,
    output: IntegrationStatus,
    options: { ...operational("integration_status", IntegrationNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        if (input.integrationID === "")
          return yield* new Tool.Error({ message: "integrationID is required" })
        yield* toolContext.permission({ action: "integration_status", resources: [input.integrationID] })
        const integrationID = Integration.ID.make(input.integrationID)
        const info = yield* integration
          .get({ integrationID })
          .pipe(Effect.mapError(() => new Tool.Error({ message: "Integration is unavailable" })))
        if (!info) return yield* new Tool.Error({ message: "Integration is not configured" })
        const attempt =
          input.attemptID === undefined
            ? undefined
            : yield* integration.oauth
                .status({ integrationID, attemptID: Integration.AttemptID.make(input.attemptID) })
                .pipe(
                  Effect.mapError(
                    () => new Tool.Error({ message: "OAuth authorization attempt is not available" }),
                  ),
                )
        return { output: { integration: info, ...(attempt === undefined ? {} : { attempt }) } }
      }),
  })
}
