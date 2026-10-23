import { describe, expect, it } from "@effect/vitest"
import type { IntegrationMethodRegistration } from "@bymorning/plugin/effect/integration"
import { AgentSchema } from "@bymorning/schema/agent"
import { Credential as CredentialSchema } from "@bymorning/schema/credential"
import { Event } from "@bymorning/schema/event"
import { Integration as IntegrationSchema } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { Model } from "@bymorning/schema/model"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import * as Message from "@bymorning/schema/message"
import { Tool as ToolSchema } from "@bymorning/schema/tool"
import { Project } from "@bymorning/schema/project"
import { ProjectDirectory as ProjectDirectorySchema } from "@bymorning/schema/project-directory"
import { SessionSchema } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { Account } from "@bymorning/schema/account"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { fromPromise } from "@bymorning/plugin/promise/adapter"
import type { ToolBeforeResult, ToolExecuteBefore } from "@bymorning/plugin/promise/tool"
import { User } from "@bymorning/schema/user"
import { Cause, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { Agent } from "../src/agent.js"
import { Bus } from "../src/bus.js"
import { Integration } from "../src/integration.js"
import { IntegrationOAuthCallback } from "../src/integration-oauth-callback.js"
import type { Implementation, MethodDefinition, MethodSelector } from "../src/integration/definition.js"
import { PluginHost } from "../src/plugin/host.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { PluginRuntime } from "../src/plugin/runtime.js"
import { Job } from "../src/job.js"
import { Storage } from "../src/storage.js"
import { Tool } from "../src/tool.js"
import { Session } from "../src/session.js"
import { SessionOperations } from "../src/session-operations.js"
import { InstructionDiscovery } from "../src/instruction-discovery.js"

const workspaceA = Workspace.ID.make("wrk_host_a")
const workspaceB = Workspace.ID.make("wrk_host_b")
const storageLayer = Storage.layer({
  configure: (editor) => {
    const provider = Storage.memory()
    editor.add(provider)
    editor.default.set(provider.id)
  },
})
const exaID = Schema.decodeUnknownSync(IntegrationSchema.ID)("exa")
const agentA = AgentSchema.Info.make({
  id: AgentSchema.ID.make("workspace-a"),
  name: AgentSchema.Name.make("workspace-a"),
  instructions: "A",
  model: { provider: Provider.Name.make("bymorning"), id: "model-a" },
  mode: "primary",
  hidden: false,
  steps: 1,
  permissions: [],
})

describe("PluginHost", () => {
  it.effect("bridges scoped storage values and typed failures to Promise plugins", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const projectID = Project.ID.create()
      const host = PluginHost.make(services(workspaceA, storage), "promise-storage", {}, { type: "project", projectID })
      yield* fromPromise({
        id: "promise-storage",
        async setup(context) {
          await context.storage.set("cursor", { page: 3 })
          expect(await context.storage.get("cursor")).toEqual({ page: 3 })
          expect(await context.storage.scan({ prefix: "cur", limit: 1 })).toEqual({
            entries: [{ key: "cursor", value: { page: 3 } }],
          })
          await expect(context.storage.scan({ prefix: "", limit: 0 })).rejects.toMatchObject({
            _tag: "Storage.InputError", operation: "scan", reason: "limit",
          })
          await expect(context.storage.set("invalid", NaN)).rejects.toMatchObject({
            _tag: "Storage.InputError", operation: "set", reason: "json",
          })
          await context.storage.remove("cursor")
          expect(await context.storage.get("cursor")).toBeUndefined()
          await context.storage.set("persistent", true)
        },
      }).effect(host)
      // Project provenance and rebuilding a host do not add a namespace or erase its values.
      const reloaded = PluginHost.make(services(workspaceA, storage), "promise-storage")
      expect(yield* reloaded.storage.get("persistent")).toBe(true)
      expect(yield* storage.scope({ workspaceID: workspaceA, pluginID: "promise-storage" }).get("persistent")).toBe(true)
      expect(yield* PluginHost.make(services(workspaceB, storage), "promise-storage").storage.get("persistent")).toBeUndefined()
      expect(yield* PluginHost.make(services(workspaceA, storage), "other-plugin").storage.get("persistent")).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(storageLayer)),
  )

  it.effect("tracks integration IDs for each registration and clears explicitly disposed contributions", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const contribution: PluginHost.Contribution = { integrations: new Map(), tools: new Map() }
      const callbacks: Array<(editor: Integration.Editor) => void> = []
      const editor: Integration.Editor = {
        list: () => [],
        get: () => undefined,
        update: () => undefined,
        remove: () => undefined,
        method: { list: () => [], update: () => undefined, remove: () => undefined },
      }
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            transform: (callback) =>
              Effect.sync(() => {
                callbacks.push(callback)
                callback(editor)
                return { dispose: Effect.void }
              }),
          },
        }),
        "example.package",
        {},
        undefined,
        contribution,
      )
      const registration = yield* host.integration.transform((editor) => {
        editor.update("example-mail", () => {})
        editor.method.update({ integrationID: "example-key", method: { type: "key" } })
        editor.update("removed", () => {})
        editor.remove("removed")
      })
      expect([...contribution.integrations.values()].flatMap((ids) => [...ids])).toEqual([
        "example-mail",
        "example-key",
      ])
      callbacks.forEach((callback) => callback(editor))
      expect(contribution.integrations.size).toBe(1)
      expect([...contribution.integrations.values()].flatMap((ids) => [...ids])).toEqual([
        "example-mail",
        "example-key",
      ])
      yield* registration.dispose
      expect(contribution.integrations.size).toBe(0)
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("exposes instruction list and transform", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const projectID = Project.ID.create()
      const files = [new InstructionDiscovery.File({ path: "workspace", content: "initial" })]
      const instruction = InstructionDiscovery.Service.of({
        project: true,
        list: () => Effect.succeed(files),
        load: () => Effect.succeed([]),
        reload: () => Effect.void,
        transform: (callback) =>
          Effect.sync(() => {
            callback({
              list: () => files,
              add: (file) => files.push(new InstructionDiscovery.File(file)),
              update: (_path, _projectID, update) => {
                const current = files[0]
                if (current) update(current)
              },
              remove: () => undefined,
              unavailable: () => undefined,
            })
            return { dispose: Effect.void }
          }),
      })
      const host = PluginHost.make(services(workspaceA, storage, { instruction }))
      yield* host.instruction.transform((editor) => {
        editor.update("workspace", undefined, (file) => {
          file.content = "updated"
        })
        editor.add({ path: "project", content: "scoped", projectID })
      })
      expect(yield* host.instruction.list(projectID)).toEqual([
        new InstructionDiscovery.File({ path: "workspace", content: "updated" }),
        new InstructionDiscovery.File({ path: "project", content: "scoped", projectID }),
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("exposes the captured Workspace and optional source Project", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const projectID = Project.ID.create()
      const workspaceHost = PluginHost.make(services(workspaceA, storage))
      const projectHost = PluginHost.make(
        services(workspaceA, storage),
        "project-plugin",
        {},
        PluginSchema.Source.make({ type: "project", projectID }),
      )

      expect(workspaceHost.location).toEqual({ workspaceID: workspaceA })
      expect(projectHost.location).toEqual({ workspaceID: workspaceA, projectID })
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("keeps optional Provider and Model transport metadata in the public plugin catalog", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const provider = Provider.Info.make({
        name: Provider.Bymorning,
        displayName: "ByMorning",
        api: Provider.API.make("https://api.example.com"),
        format: "openai",
        status: "enabled",
      })
      const info = Model.Info.make({
        id: "usable",
        provider: Provider.Bymorning,
        apiID: "usable",
        name: "Usable",
        description: "Usable model",
        status: "active",
        releaseDate: "2026-01-01",
        lastUpdated: "2026-01-01",
        openWeights: false,
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          tools: true,
          input: ["text"],
          output: ["text", "image"],
        },
        variants: [],
        limit: { context: 128_000, output: 8_192 },
        cost: { input: 1, output: 2, cache: {} },
      })
      const catalog = services(workspaceA, storage).catalog
      const host = PluginHost.make(
        services(workspaceA, storage, {
          catalog: {
            ...catalog,
            provider: {
              ...catalog.provider,
              available: () => Effect.succeed([provider]),
            },
            model: {
              ...catalog.model,
              available: () => Effect.succeed([info]),
              visible: () => Effect.die(new Error("Management rows must not cross the plugin boundary")),
            },
          },
        }),
      )

      expect(yield* host.catalog.provider.list()).toEqual([provider])
      expect(yield* host.catalog.model.list()).toEqual([info])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("forwards key form answers to the captured Integration service", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const inputs: Parameters<Integration.Interface["connection"]["key"]>[0][] = []
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            connection: {
              ...integration.connection,
              key: (input) => Effect.sync(() => inputs.push(input)).pipe(Effect.asVoid),
            },
          },
        }),
      )

      yield* host.integration.connect.key({
        integrationID: exaID,
        key: "secret",
        answer: { region: "eu", retries: 2, enabled: false, scopes: ["read"] },
      })
      yield* host.integration.connect.key({
        integrationID: exaID,
        key: "regional-secret",
        configuration: { type: "aws-region", region: AwsRegion.make("us-east-1") },
      })

      expect(inputs).toEqual([
        {
          integrationID: exaID,
          key: "secret",
          label: undefined,
          answer: { region: "eu", retries: 2, enabled: false, scopes: ["read"] },
        },
        {
          integrationID: exaID,
          key: "regional-secret",
          label: undefined,
          answer: { region: AwsRegion.make("us-east-1") },
        },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("forwards AWS connections without widening method registration", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const calls: Parameters<Integration.Interface["connection"]["awsSigV4"]>[0][] = []
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            connection: {
              ...integration.connection,
              awsSigV4: (input) => Effect.sync(() => calls.push(input)).pipe(Effect.asVoid),
            },
          },
        }),
      )
      const input = {
        integrationID: IntegrationSchema.ID.make("amazon-bedrock"),
        methodID: IntegrationSchema.BedrockAwsSigV4MethodID,
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret",
        sessionToken: "session",
        region: AwsRegion.make("us-east-1"),
        label: "Work",
      }

      yield* host.integration.connect.awsSigV4(input)

      expect(calls).toEqual([
        {
          integrationID: input.integrationID,
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
          sessionToken: input.sessionToken,
          region: input.region,
          label: input.label,
        },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("projects legacy, grouped AWS, and regional connection metadata without credentials", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const region = AwsRegion.make("us-west-2")
      const resolved: string[] = []
      const info = IntegrationSchema.Info.make({
        id: IntegrationSchema.ID.make("amazon-bedrock"),
        name: "Amazon Bedrock",
        methods: [
          { type: "key", label: "Bearer token" },
          { type: "env", names: ["LEGACY_TOKEN"] },
          {
            id: IntegrationSchema.BedrockAwsSigV4MethodID,
            type: "aws-sigv4",
            label: "AWS credentials",
            region: { key: "region", type: "string", required: true },
          },
          {
            id: IntegrationSchema.BedrockBearerEnvMethodID,
            type: "env-group",
            authKind: "bedrock-bearer",
            available: true,
          },
          {
            id: IntegrationSchema.BedrockSigV4EnvMethodID,
            type: "env-group",
            authKind: "aws-sigv4",
            available: false,
          },
        ],
        connections: [
          { type: "credential", id: CredentialSchema.ID.make("cred_legacy"), label: "Legacy" },
          { type: "env", name: "LEGACY_TOKEN" },
          {
            type: "regional-credential",
            id: CredentialSchema.ID.make("cred_aws"),
            label: "AWS",
            authKind: "sigv4",
            region,
          },
          { type: "regional-env", authKind: "bearer", region },
        ],
      })
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            get: () => Effect.succeed(info),
            list: () => Effect.succeed([info]),
            connection: {
              ...integration.connection,
              resolve: (connection) => Effect.sync(() => resolved.push(connection.type)).pipe(Effect.as(undefined)),
            },
          },
        }),
      )
      expect(yield* host.integration.get({ integrationID: info.id })).toEqual(info)
      expect(yield* host.integration.connection.resolve(info.connections[0])).toBeUndefined()
      expect(yield* host.integration.connection.resolve(info.connections[2])).toBeUndefined()
      const projected = [yield* host.integration.get({ integrationID: info.id }), yield* host.integration.list()]

      expect(projected).toEqual([info, [info]])
      expect(JSON.stringify(projected)).not.toContain("secretAccessKey")
      expect(JSON.stringify(projected)).not.toContain("accessKeyId")
      expect(JSON.stringify(projected)).not.toContain("AWS_")
      expect(resolved).toEqual(["credential"])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("maps every visible integration method to a transport-safe removal selector", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const methods = [
        { id: IntegrationSchema.MethodID.make("oauth"), type: "oauth", label: "OAuth" },
        { id: IntegrationSchema.MethodID.make("command"), type: "command", label: "CLI", command: ["login"] },
        { type: "key", label: "API key" },
        { type: "env", names: ["API_KEY"] },
        {
          id: IntegrationSchema.BedrockAwsSigV4MethodID,
          type: "aws-sigv4",
          label: "AWS",
          region: { key: "region", type: "string", required: true },
        },
        IntegrationSchema.BedrockEnvMethods[0],
      ] satisfies readonly MethodDefinition[]
      const selectors: MethodSelector[] = []
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            transform: (callback) =>
              Effect.sync(() =>
                callback({
                  list: () => [],
                  get: () => undefined,
                  update: () => undefined,
                  remove: () => undefined,
                  method: {
                    list: () => methods,
                    update: () => undefined,
                    remove: (_integrationID, selector) => selectors.push(selector),
                  },
                }),
              ).pipe(Effect.as({ dispose: Effect.void })),
          },
        }),
      )

      yield* host.integration.transform((editor) => {
        for (const method of editor.method.list("amazon-bedrock")) {
          editor.method.remove("amazon-bedrock", method)
        }
      })

      expect(selectors).toEqual([
        { type: "oauth", id: "oauth" },
        { type: "command", id: "command" },
        { type: "key" },
        { type: "env" },
        { type: "aws-sigv4", id: IntegrationSchema.BedrockAwsSigV4MethodID },
        { type: "env-group", id: IntegrationSchema.BedrockBearerEnvMethodID },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("rejects host-owned AWS method registration from external plugins", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const base = services(workspaceA, storage)
      const host = PluginHost.make(
        {
          ...base,
          integration: {
            ...base.integration,
            transform: (callback) =>
              Effect.sync(() =>
                callback({
                  list: () => [],
                  get: () => undefined,
                  update: () => undefined,
                  remove: () => undefined,
                  method: { list: () => [], update: () => undefined, remove: () => undefined },
                }),
              ).pipe(Effect.as({ dispose: Effect.void })),
          },
        },
        "external-plugin",
        {},
        { type: "local", path: "/plugin.ts" },
      )
      const exit = yield* host.integration
        .transform((editor) =>
          editor.method.update({
            integrationID: "amazon-bedrock",
            method: {
              id: IntegrationSchema.BedrockAwsSigV4MethodID,
              type: "aws-sigv4",
              label: "Untrusted AWS",
              region: { key: "region", type: "string", required: true },
            },
          } as never),
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("keeps plugin credential closures bound to their captured account Integration", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const calls: string[] = []
      const makeHost = (account: string) => {
        const integration = services(workspaceA, storage).integration
        return PluginHost.make(
          services(workspaceA, storage, {
            integration: {
              ...integration,
              connection: {
                ...integration.connection,
                key: () => Effect.sync(() => calls.push(account)).pipe(Effect.asVoid),
              },
            },
          }),
        )
      }
      const first = makeHost("first")
      const second = makeHost("second")

      yield* first.integration.connect.key({ integrationID: exaID, key: "first-secret" })
      yield* second.integration.connect.key({ integrationID: exaID, key: "second-secret" })

      expect(calls).toEqual(["first", "second"])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("forwards OAuth and command attempts with branded Integration identifiers", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const calls: Array<{ readonly operation: string; readonly input: unknown }> = []
      const integration = services(workspaceA, storage).integration
      const host = PluginHost.make(
        services(workspaceA, storage, {
          integration: {
            ...integration,
            oauth: {
              connect: (input) =>
                Effect.sync(() => calls.push({ operation: "oauth.connect", input })).pipe(
                  Effect.as(
                    Integration.Attempt.make({
                      attemptID: Integration.AttemptID.make("con_oauth"),
                      url: "https://example.com",
                      instructions: "Continue",
                      mode: "code",
                      time: { created: 1, expires: 2 },
                    }),
                  ),
                ),
              status: (input) =>
                Effect.sync(() => calls.push({ operation: "oauth.status", input })).pipe(
                  Effect.as({ status: "pending" as const, time: { created: 1, expires: 2 } }),
                ),
              complete: (input) =>
                Effect.sync(() => calls.push({ operation: "oauth.complete", input })).pipe(Effect.asVoid),
              cancel: (input) =>
                Effect.sync(() => calls.push({ operation: "oauth.cancel", input })).pipe(Effect.asVoid),
            },
            command: {
              connect: (input) =>
                Effect.sync(() => calls.push({ operation: "command.connect", input })).pipe(
                  Effect.as({ attemptID: Integration.AttemptID.make("con_command"), time: { created: 1, expires: 2 } }),
                ),
              status: (input) =>
                Effect.sync(() => calls.push({ operation: "command.status", input })).pipe(
                  Effect.as({ status: "pending" as const, message: "waiting\n", time: { created: 1, expires: 2 } }),
                ),
              cancel: (input) =>
                Effect.sync(() => calls.push({ operation: "command.cancel", input })).pipe(Effect.asVoid),
            },
          },
        }),
      )

      const integrationID = IntegrationSchema.ID.make("github")
      const methodID = IntegrationSchema.MethodID.make("device")
      const oauthAttemptID = IntegrationSchema.AttemptID.make("con_oauth")
      const commandAttemptID = IntegrationSchema.AttemptID.make("con_command")
      yield* host.integration.oauth.connect({ integrationID, methodID, answer: { region: "eu" }, label: "Work" })
      yield* host.integration.oauth.status({ integrationID, attemptID: oauthAttemptID })
      yield* host.integration.oauth.complete({ integrationID, attemptID: oauthAttemptID, code: "answer" })
      yield* host.integration.oauth.cancel({ integrationID, attemptID: oauthAttemptID })
      yield* host.integration.command.connect({ integrationID, methodID, label: "CLI" })
      yield* host.integration.command.status({ integrationID, attemptID: commandAttemptID })
      yield* host.integration.command.cancel({ integrationID, attemptID: commandAttemptID })

      expect(calls).toEqual([
        {
          operation: "oauth.connect",
          input: { integrationID, methodID, answer: { region: "eu" }, label: "Work" },
        },
        { operation: "oauth.status", input: { integrationID, attemptID: oauthAttemptID } },
        { operation: "oauth.complete", input: { integrationID, attemptID: oauthAttemptID, code: "answer" } },
        { operation: "oauth.cancel", input: { integrationID, attemptID: oauthAttemptID } },
        { operation: "command.connect", input: { integrationID, methodID, label: "CLI" } },
        { operation: "command.status", input: { integrationID, attemptID: commandAttemptID } },
        { operation: "command.cancel", input: { integrationID, attemptID: commandAttemptID } },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("binds Effect and Promise callback registrations to the captured account, Workspace, and plugin", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const owners: IntegrationOAuthCallback.Owner[] = []
      const projectID = Project.ID.create()
      const source = PluginSchema.Source.make({ type: "project", projectID })
      const bound = services(workspaceA, storage, {
        accountID: Account.ID.make("acc_plugin_host"),
        integrationOAuthCallback: {
          register: (owner) =>
            Effect.sync(() => owners.push(owner)).pipe(
              Effect.as({
                state: "host-state",
                callbackURI: "https://app.example/auth/integration/callback",
                expiresAt: 123,
                wait: Effect.succeed({ code: "provider-code" }),
              }),
            ),
          deliver: () => Effect.succeed(false),
        },
      })
      const host = PluginHost.make(bound, "effect-plugin", {}, source)
      expect(host.location).toEqual({ workspaceID: workspaceA, projectID })
      const effectRegistration = yield* host.integration.oauth.callback.register()
      expect(yield* effectRegistration.wait).toEqual({ code: "provider-code" })

      yield* fromPromise({
        id: "promise-plugin",
        setup: async (context) => {
          expect(context.location).toEqual({ workspaceID: workspaceA, projectID })
          const registration = await context.integration.oauth.callback.register()
          expect(await registration.wait).toEqual({ code: "provider-code" })
        },
      }).effect(PluginHost.make(bound, "promise-plugin", {}, source))

      expect(owners).toEqual([
        { accountID: "acc_plugin_host", workspaceID: workspaceA, pluginID: "effect-plugin" },
        { accountID: "acc_plugin_host", workspaceID: workspaceA, pluginID: "promise-plugin" },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )


  it.effect("provides equivalent Effect and Promise routing provenance with host provider scoping", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const hooks = yield* PluginHooks.Service
        const host = PluginHost.make(services(workspaceA, storage, { shellHooks: hooks }), "promise-policy")
        const requestedModel = Model.Ref.make({ provider: Provider.Bymorning, id: "gpt-5.6-sol" })
        let effectObserved: unknown
        let promiseObserved: unknown
        let incorrectlyMatched = false

        yield* fromPromise({
          id: "promise-policy",
          setup: async (context) => {
            await context.session.hook(
              "model.request",
              (event) => {
                event.model = { provider: Provider.Bymorning, id: "gpt-5.6-terra" }
                promiseObserved = {
                  requestedModel: event.requestedModel,
                  model: event.model,
                  purpose: event.purpose,
                }
              },
              { providerID: Provider.Bymorning },
            )
            await context.session.hook(
              "model.request",
              () => {
                incorrectlyMatched = true
              },
              { providerID: "other-provider" },
            )
          },
        }).effect(host)
        yield* host.session.hook(
          "model.request",
          (event) =>
            Effect.sync(() => {
              effectObserved = {
                requestedModel: event.requestedModel,
                model: event.model,
                purpose: event.purpose,
              }
            }),
          { providerID: Provider.Bymorning },
        )

        const routed = yield* hooks.trigger("session", "model.request", {
          purpose: "assistant",
          sessionID: SessionSchema.ID.make("00000000-0000-4000-8000-000000000701"),
          agent: AgentSchema.ID.make("build"),
          requestedModel,
          model: { ...requestedModel },
          headers: {},
        })

        expect(promiseObserved).toEqual({
          requestedModel,
          model: routed.model,
          purpose: "assistant",
        })
        expect(effectObserved).toEqual(promiseObserved)
        expect(incorrectlyMatched).toBe(false)
      }),
    ).pipe(Effect.provide(Layer.merge(storageLayer, PluginHooks.layer))),
  )

  it.effect("maps a returned Promise Tool.Error to typed denial", () => {
    const error = new ToolSchema.Error({ message: "blocked by Promise policy" })
    return Effect.scoped(runPromiseBeforeHook(() => error)).pipe(
      Effect.flip,
      Effect.tap((result) => Effect.sync(() => expect(result).toBe(error))),
      Effect.provide(Layer.merge(storageLayer, PluginHooks.layer)),
    )
  })

  it.effect("keeps unexpected Promise rejection as a defect", () =>
    Effect.scoped(runPromiseBeforeHook(() => Promise.reject(new Error("plugin exploded")))).pipe(
      Effect.exit,
      Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true))),
      Effect.provide(Layer.merge(storageLayer, PluginHooks.layer)),
    ),
  )

  it.effect("rejects an invalid resolved Promise before-hook value as a defect", () =>
    Effect.scoped(runPromiseBeforeHook((() => ({ message: "not Tool.Error" })) as never)).pipe(
      Effect.exit,
      Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true))),
      Effect.provide(Layer.merge(storageLayer, PluginHooks.layer)),
    ),
  )

  it.effect("hosts dedicated gateway hooks without session provenance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const hooks = yield* PluginHooks.Service
        const observed: unknown[] = []
        const host = PluginHost.make(services(workspaceA, storage, { shellHooks: hooks }), "gateway-hook")
        yield* host.gateway.hook("tool.execute.before", (event) =>
          Effect.sync(() => {
            observed.push({ ...event })
            event.input = { value: "transformed" }
          }),
        )
        yield* host.gateway.hook("tool.execute.after", (event) =>
          Effect.sync(() => {
            observed.push(event)
          }),
        )

        const input = yield* hooks.trigger("gateway", "tool.execute.before", {
          id: ToolSchema.CallID.make("call_gateway"),
          userID: User.ID.make("usr_gateway"),
          tool: "lookup",
          input: { value: "original" },
        })
        const after = {
          ...input,
          status: "completed" as const,
          result: { content: "done" },
        }
        yield* hooks.trigger("gateway", "tool.execute.after", after)
        expect(observed).toEqual([
          {
            id: input.id,
            userID: input.userID,
            tool: "lookup",
            input: { value: "original" },
          },
          after,
        ])
      }),
    ).pipe(Effect.provide(Layer.merge(storageLayer, PluginHooks.layer))),
  )

  it.effect("removes a Promise callback when its OAuth attempt is cancelled", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const callbacks = yield* IntegrationOAuthCallback.Service
      const registrations: Implementation[] = []
      const integration = {
        transform: (callback: (editor: Integration.Editor) => void) =>
          Effect.sync(() =>
            callback({
              list: () => [],
              get: () => undefined,
              update: () => undefined,
              remove: () => undefined,
              method: {
                list: () => [],
                update: (implementation) => registrations.push(implementation),
                remove: () => undefined,
              },
            }),
          ).pipe(Effect.as({ dispose: Effect.void })),
      } as unknown as Integration.Interface
      const host = PluginHost.make(
        services(workspaceA, storage, {
          accountID: Account.ID.make("acc_promise_attempt"),
          integration,
          integrationOAuthCallback: callbacks,
        }),
        "promise-oauth",
      )
      const pluginScope = yield* Scope.make()
      let setupState = ""
      let attemptState = ""

      yield* fromPromise({
        id: "promise-oauth",
        setup: async (context) => {
          setupState = (await context.integration.oauth.callback.register()).state
          await context.integration.transform((editor) =>
            editor.method.update({
              integrationID: "example",
              method: { id: "oauth", type: "oauth", label: "OAuth" },
              authorize: async () => {
                await Promise.resolve()
                const callback = await context.integration.oauth.callback.register()
                attemptState = callback.state
                return {
                  url: "https://example.com/authorize",
                  instructions: "Continue in the browser",
                  mode: "auto",
                  callback: callback.wait.then(() => ({
                    type: "oauth",
                    methodID: IntegrationSchema.MethodID.make("oauth"),
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                  })),
                }
              },
            }),
          )
        },
      })
        .effect(host)
        .pipe(Scope.provide(pluginScope))

      const implementation = registrations[0]
      if (!implementation || !("authorize" in implementation)) {
        return yield* Effect.die(new Error("Promise OAuth method missing"))
      }
      const attemptScope = yield* Scope.make()
      yield* implementation.authorize({}, {}).pipe(Scope.provide(attemptScope))
      yield* Scope.close(attemptScope, Exit.void)

      expect(yield* callbacks.deliver({ state: attemptState, code: "late" })).toBe(false)
      yield* Scope.close(pluginScope, Exit.void)
      expect(yield* callbacks.deliver({ state: setupState, code: "after-unload" })).toBe(false)
    }).pipe(Effect.provide(Layer.merge(storageLayer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  it.effect("never routes transport-shaped Workspace IDs away from its captured services", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const host = PluginHost.make(
        services(workspaceA, storage, {
          agent: Agent.Service.of({
            list: Effect.succeed([agentA]),
            get: () => Effect.succeed(agentA),
            resolve: Effect.succeed(agentA),
            create: Effect.succeed,
            update: () => Effect.succeed(agentA),
            delete: () => Effect.void,
            transform: () => Effect.succeed({ dispose: Effect.void }),
            reload: () => Effect.void,
          }),
        }),
      )

      expect(yield* host.agent.list({ workspace: workspaceB })).toEqual([agentA])
      expect((yield* host.agent.get({ id: agentA.id, workspace: workspaceB })).name).toBe(agentA.name)
    }).pipe(Effect.provide(storageLayer)),
  )

  it("owns Tool registrations, hooks, and per-Workspace plugin storage", () =>
    Effect.runPromise(Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const tools = yield* Tool.Service
        const hooks = yield* PluginHooks.Service
        const hostA = PluginHost.make(services(workspaceA, storage, { tool: tools, shellHooks: hooks }), "shared")
        const hostB = PluginHost.make(services(workspaceB, storage, { tool: tools, shellHooks: hooks }), "shared")
        const commands: string[] = []

        yield* hostA.tool.transform((editor) =>
          editor.add({
            name: "host-tool",
            description: "host tool",
            input: Schema.Struct({}),
            execute: () => Effect.succeed({ output: "ok" }),
          }),
        )
        yield* hostA.shell.hook("create.before", (event) =>
          Effect.sync(() => {
            commands.push(event.command)
          }),
        )
        yield* hooks.trigger("shell", "create.before", {
          command: "pwd",
          cwd: "/tmp",
          timeout: 1,
          shell: "sh",
          env: {},
        })
        yield* hostA.storage.set("key", "A")
        yield* hostB.storage.set("key", "B")

        expect((yield* tools.snapshot()).codeModeCatalog?.tools).toContainEqual(
          expect.objectContaining({ type: "tool", name: "host-tool" }),
        )
        expect(commands).toEqual(["pwd"])
        expect(yield* hostA.storage.get("key")).toBe("A")
        expect(yield* hostB.storage.get("key")).toBe("B")
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(storageLayer, PluginHooks.layer, Tool.layer.pipe(Layer.provide(PluginHooks.layer))),
      ),
    ),
    ),
  )

  it.effect("projects only the captured Workspace Bus into the public event stream", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const event = {
        id: Event.ID.make("00000000-0000-4000-8000-000000000401"),
        type: "config.updated" as const,
        created: 1,
        data: {},
      }
      const host = PluginHost.make(
        services(workspaceA, storage, {
          bus: { subscribe: () => Effect.succeed(Stream.succeed(event)) } as unknown as Bus.Interface,
        }),
      )

      expect(yield* host.event.subscribe().pipe(Stream.runCollect)).toEqual([event])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("decodes OAuth registrations and credentials at the plugin boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const registrations: Implementation[] = []
        const integration = {
          transform: (callback: (editor: Integration.Editor) => void) =>
            Effect.sync(() =>
              callback({
                list: () => [],
                get: () => undefined,
                update: () => undefined,
                remove: () => undefined,
                method: {
                  list: () => [],
                  update: (implementation) => registrations.push(implementation),
                  remove: () => undefined,
                },
              }),
            ).pipe(Effect.as({ dispose: Effect.void })),
        } as unknown as Integration.Interface
        const host = PluginHost.make(services(workspaceA, storage, { integration }))

        yield* host.integration.transform((editor) =>
          editor.method.update({
            integrationID: "github",
            method: { id: "device", type: "oauth", label: "GitHub" },
            authorize: () =>
              Effect.succeed({
                url: "https://example.com/authorize",
                instructions: "Continue in the browser",
                mode: "code",
                callback: () =>
                  Effect.succeed({
                    type: "oauth",
                    methodID: "device",
                    refresh: "refresh",
                    access: "access",
                    expires: 1,
                  } as CredentialSchema.OAuth),
              }),
            refresh: () =>
              Effect.succeed({
                type: "oauth",
                methodID: "device",
                refresh: "next-refresh",
                access: "next-access",
                expires: 2,
              } as CredentialSchema.OAuth),
          }),
        )

        const implementation = registrations[0]
        expect(implementation?.integrationID).toBe(IntegrationSchema.ID.make("github"))
        expect(implementation?.method).toEqual({ id: "device", type: "oauth", label: "GitHub" })
        if (!implementation || !("authorize" in implementation)) return
        const authorization = yield* implementation.authorize({}, {})
        expect(authorization.mode).toBe("code")
        if (authorization.mode !== "code") return
        expect(yield* authorization.callback("answer")).toEqual({
          type: "oauth",
          methodID: "device",
          refresh: "refresh",
          access: "access",
          expires: 1,
        })
        if (!implementation.refresh) return
        expect(yield* implementation.refresh(yield* authorization.callback("answer"), {})).toEqual({
          type: "oauth",
          methodID: "device",
          refresh: "next-refresh",
          access: "next-access",
          expires: 2,
        })
      }),
    ).pipe(Effect.provide(storageLayer)),
  )

  it.effect("rejects malformed OAuth methods and callback credentials", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const registrations: Implementation[] = []
        const integration = {
          transform: (callback: (editor: Integration.Editor) => void) =>
            Effect.sync(() =>
              callback({
                list: () => [],
                get: () => undefined,
                update: () => undefined,
                remove: () => undefined,
                method: {
                  list: () => [],
                  update: (implementation) => registrations.push(implementation),
                  remove: () => undefined,
                },
              }),
            ).pipe(Effect.as({ dispose: Effect.void })),
        } as unknown as Integration.Interface
        const host = PluginHost.make(services(workspaceA, storage, { integration }))
        const malformedMethod = yield* host.integration
          .transform((editor) =>
            editor.method.update({
              integrationID: "github",
              method: { id: "device", type: "oauth", label: 1 },
              authorize: () => Effect.die("unused"),
            } as unknown as IntegrationMethodRegistration),
          )
          .pipe(Effect.exit)
        expect(Exit.isFailure(malformedMethod)).toBe(true)
        expect(registrations).toEqual([])

        for (const client of [
          [
            { key: "client_id", type: "string" },
            { key: "client_id", type: "string" },
          ],
          [{ key: "client_secret", type: "string", secret: true, default: "unsafe" }],
          [
            { key: "region", type: "string", options: [{ value: "us", label: "US" }] },
            { key: "client_id", type: "string", when: [{ key: "region", op: "eq", value: "eu" }] },
          ],
        ] as const) {
          const invalidClient = yield* host.integration
            .transform((editor) =>
              editor.method.update({
                integrationID: "github",
                method: { id: "device", type: "oauth", label: "GitHub", client },
                authorize: () => Effect.die("unused"),
              } as unknown as IntegrationMethodRegistration),
            )
            .pipe(Effect.exit)
          expect(Exit.isFailure(invalidClient)).toBe(true)
          expect(registrations).toEqual([])
        }

        yield* host.integration.transform((editor) =>
          editor.method.update({
            integrationID: "github",
            method: { id: "device", type: "oauth", label: "GitHub" },
            authorize: () =>
              Effect.succeed({
                url: "https://example.com/authorize",
                instructions: "Continue in the browser",
                mode: "auto",
                callback: Effect.succeed({
                  type: "oauth",
                  methodID: "device",
                  refresh: "refresh",
                  access: "access",
                  expires: "never",
                } as unknown as CredentialSchema.OAuth),
              }),
            refresh: () =>
              Effect.succeed({
                type: "oauth",
                methodID: "device",
                refresh: "refresh",
                access: "access",
                expires: "never",
              } as unknown as CredentialSchema.OAuth),
          }),
        )
        const implementation = registrations[0]
        if (!implementation || !("authorize" in implementation)) return
        const authorization = yield* implementation.authorize({}, {})
        if (authorization.mode !== "auto") return
        expect(Exit.isFailure(yield* authorization.callback.pipe(Effect.exit))).toBe(true)
        if (!implementation.refresh) return
        expect(
          Exit.isFailure(
            yield* implementation
              .refresh(
                CredentialSchema.OAuth.make({
                  type: "oauth",
                  methodID: IntegrationSchema.MethodID.make("device"),
                  refresh: "refresh",
                  access: "access",
                  expires: 1,
                }),
                {},
              )
              .pipe(Effect.exit),
          ),
        ).toBe(true)
      }),
    ).pipe(Effect.provide(storageLayer)),
  )

  it.effect("rejects an OAuth method without authorize, unknown method types, and host-owned types as the plugin's InputError", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        const registrations: Implementation[] = []
        const integration = {
          transform: (callback: (editor: Integration.Editor) => void) =>
            Effect.sync(() =>
              callback({
                list: () => [],
                get: () => undefined,
                update: () => undefined,
                remove: () => undefined,
                method: {
                  list: () => [],
                  update: (implementation) => registrations.push(implementation),
                  remove: () => undefined,
                },
              }),
            ).pipe(Effect.as({ dispose: Effect.void })),
        } as unknown as Integration.Interface
        const pluginID = "project.integration.google-workspace"
        const host = PluginHost.make(services(workspaceA, storage, { integration }), pluginID, {}, {
          type: "project",
          projectID: Project.ID.make("prj_00000000000000000000incdnt"),
          path: ProjectDirectorySchema.Path.make("plugin/google-workspace.ts"),
        })
        const rejection = (method: unknown) =>
          host.integration
            .transform((editor) =>
              editor.method.update({ integrationID: "google-workspace", method } as unknown as IntegrationMethodRegistration),
            )
            .pipe(
              Effect.exit,
              Effect.map((exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined)),
            )

        // The production incident: an OAuth method registered without its authorize function.
        const incident = yield* rejection({
          id: "oauth",
          type: "oauth",
          label: "Google",
          client: {
            fields: [
              { key: "clientID", title: "Client ID", type: "string", required: true },
              { key: "clientSecret", title: "Client secret", type: "string", required: true, secret: true },
            ],
          },
          form: [{ key: "authorizationURL", type: "string", default: "https://accounts.google.com/o/oauth2/v2/auth" }],
        })
        expect(incident).toMatchObject({
          _tag: "PluginHost.InputError",
          pluginID,
          message: "OAuth method oauth for integration google-workspace needs an authorize function",
        })
        expect(incident).toBeInstanceOf(PluginHost.InputError)

        const unknown = yield* rejection({ id: "sso", type: "saml", label: "SSO" })
        expect(unknown).toMatchObject({
          _tag: "PluginHost.InputError",
          message:
            'Unknown method type "saml" for Integration method sso for integration google-workspace; expected oauth, key, command, or env',
        })

        const hostOwned = yield* rejection({ id: "aws", type: "aws-sigv4", label: "AWS", region: { key: "region", type: "string" } })
        expect(hostOwned).toMatchObject({
          _tag: "PluginHost.InputError",
          message: `Integration method type "aws-sigv4" is host-owned; plugin ${pluginID} cannot register it`,
        })

        // A declared type is decoded as that type, never as an environment method.
        const malformedKey = yield* rejection({ type: "key", label: 1 })
        expect(malformedKey).toMatchObject({
          _tag: "PluginHost.InputError",
          message: expect.stringMatching(/^Invalid Key method for integration google-workspace: /),
        })
        expect(registrations).toEqual([])
      }),
    ).pipe(Effect.provide(storageLayer)),
  )

  it.effect("defects before runtime installation and delegates after installation", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const cell = PluginRuntime.makeCell()
      const before = yield* PluginRuntime.Service.use((runtime) => runtime.session.get("missing" as never)).pipe(
        Effect.provide(PluginRuntime.layerWithCell(cell)),
        Effect.exit,
      )
      expect(Exit.isFailure(before)).toBe(true)

      const expected = { id: "session-a" }
      const projectID = Project.ID.make("prj_00000000000000000000plugin")
      const parentID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000901")
      const root = SessionSchema.Info.make({
        id: SessionSchema.ID.make("00000000-0000-4000-8000-000000000902"),
        projectID,
        title: SessionSchema.Title.make("Root"),
        agent: agentA.id,
        model: { provider: Provider.Name.make("bymorning"), id: "model-a" },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      const child = SessionSchema.Info.make({
        ...root,
        id: SessionSchema.ID.make("00000000-0000-4000-8000-000000000903"),
        parentID,
        title: SessionSchema.Title.make("Plugin child"),
      })
      const encodedRoot = yield* Schema.encodeEffect(SessionSchema.Info)(root)
      const encodedChild = yield* Schema.encodeEffect(SessionSchema.Info)(child)
      const created = new Array<unknown>()
      const interruptionReasons = new Array<string>()
      const session = Session.Service.of({
        get: () => Effect.succeed(expected),
        create: (input: Parameters<Session.Interface["create"]>[0]) =>
          Effect.sync(() => created.push(input)).pipe(Effect.as(root)),
        createChild: (input: Parameters<Session.Interface["createChild"]>[0]) =>
          Effect.sync(() => created.push(input)).pipe(Effect.as(child)),
        messages: () => Effect.die(new Error("unused")),
        resume: () => Effect.die(new Error("unused")),
        interrupt: (_: SessionSchema.ID, reason: import("../src/session/coordinator.js").InterruptReason) =>
          Effect.sync(() => interruptionReasons.push(reason)).pipe(Effect.as(root)),
      } as unknown as Session.Interface)
      const operations = SessionOperations.Service.of({
        wait: () => Effect.die(new Error("unused")),
      } as unknown as SessionOperations.Interface)
      const jobs = Job.Service.of({
        start: () => Effect.die(new Error("unused")),
        wait: () => Effect.die(new Error("unused")),
        block: () => Effect.die(new Error("unused")),
        background: () => Effect.die(new Error("unused")),
        backgroundAll: () => Effect.die(new Error("unused")),
        cancel: () => Effect.die(new Error("unused")),
      } as unknown as Job.Interface)
      const dependencies = Layer.merge(
        Layer.succeed(Session.Service, session),
        Layer.merge(Layer.succeed(SessionOperations.Service, operations), Layer.succeed(Job.Service, jobs)),
      )
      const runtime = Layer.merge(
        PluginRuntime.layerWithCell(cell),
        PluginRuntime.providerLayerWithCell(cell).pipe(Layer.provide(dependencies)),
      )
      const actual = yield* Effect.scoped(
        Effect.gen(function* () {
          const facade = yield* PluginRuntime.Service
          expect(cell.runtime?.session.get).toBe(session.get)
          expect(cell.runtime?.session.messages).toBe(session.messages)
          expect(cell.runtime?.session.resume).toBe(session.resume)
          expect(cell.runtime?.session.wait).toBe(operations.wait)
          expect(cell.runtime?.job.start).toBe(jobs.start)
          expect(Object.keys(cell.runtime?.job ?? {}).sort()).toEqual([
            "background",
            "block",
            "cancel",
            "start",
            "wait",
          ])
          const host = PluginHost.make(services(workspaceA, storage, { runtime: facade }))
          const rootInput = { projectID }
          const childInput = { parentID, title: SessionSchema.Title.make("Plugin child") }
          const fullChildInput = {
            parentID,
            title: SessionSchema.Title.make("Full plugin child"),
            agent: AgentSchema.ID.make("reviewer"),
            model: { provider: Provider.Name.make("bymorning"), id: "model-child" },
          }
          expect(yield* host.session.create(rootInput)).toBe(root)
          expect(yield* host.session.create(childInput)).toBe(child)
          yield* host.session.interrupt({ sessionID: root.id })
          expect(interruptionReasons).toEqual(["user"])
          // The facade must forward the caller's reason (upstream 87f21a301d dropped the second argument).
          yield* facade.session.interrupt(root.id, "superseded")
          expect(interruptionReasons).toEqual(["user", "superseded"])
          yield* fromPromise({
            id: "promise-child-test",
            setup: async (context) => {
              expect(await context.session.create(rootInput)).toEqual(encodedRoot)
              expect(await context.session.create(childInput)).toEqual(encodedChild)
              expect(await context.session.create({ parentID })).toEqual(encodedChild)
              expect(await context.session.create(fullChildInput)).toEqual(encodedChild)
              expect(await context.session.create({ parentID, projectID })).toEqual(encodedChild)
              const create = context.session.create as (input: unknown) => Promise<SessionSchema.Info>
              await expect(create({ parentID: 42 })).rejects.toBeDefined()
            },
          }).effect(host)
          expect(created).toEqual([
            rootInput,
            childInput,
            rootInput,
            childInput,
            { parentID },
            fullChildInput,
            { parentID },
          ])
          return yield* facade.session.get("session-a" as never)
        }).pipe(Effect.provide(runtime)),
      )
      expect(actual).toBe(expected)
      expect(cell.runtime).toBeUndefined()
    }).pipe(Effect.provide(storageLayer)),
  )
})

const runPromiseBeforeHook = (callback: (event: ToolExecuteBefore) => ToolBeforeResult | Promise<ToolBeforeResult>) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const hooks = yield* PluginHooks.Service
    yield* fromPromise({
      id: "promise-before-hook",
      setup: async (context) => {
        await context.tool.hook("execute.before", callback)
      },
    }).effect(PluginHost.make(services(workspaceA, storage, { shellHooks: hooks }), "promise-before-hook"))
    return yield* hooks.trigger("tool", "execute.before", {
      tool: "write",
      sessionID: SessionSchema.ID.make("00000000-0000-4000-8000-000000000701"),
      agent: AgentSchema.ID.make("build"),
      messageID: Message.ID.make("00000000-0000-4000-8000-000000000702"),
      id: ToolSchema.CallID.make("call_policy"),
      input: {},
    })
  })

function services(
  workspaceID: Workspace.ID,
  storage: Storage.Interface,
  overrides: Partial<PluginHost.HostServices> = {},
): PluginHost.HostServices {
  return {
    workspaceID,
    app: { name: "ByMorning", version: "test", channel: "test" },
    agent: {} as Agent.Interface,
    aisdk: {} as PluginHost.HostServices["aisdk"],
    catalog: {} as PluginHost.HostServices["catalog"],
    command: {} as PluginHost.HostServices["command"],
    http: {} as PluginHost.HostServices["http"],
    bus: {} as PluginHost.HostServices["bus"],
    integration: {} as PluginHost.HostServices["integration"],
    instruction: {} as PluginHost.HostServices["instruction"],
    mcp: {} as PluginHost.HostServices["mcp"],
    plugin: { activate: () => Effect.void, list: () => Effect.succeed([]) },
    reference: {} as PluginHost.HostServices["reference"],
    runtime: { session: {}, job: {} } as PluginRuntime.Interface,
    shellHooks: {} as PluginHooks.Interface,
    skill: {} as PluginHost.HostServices["skill"],
    storage,
    tool: {} as Tool.Interface,
    websearch: {} as PluginHost.HostServices["websearch"],
    ...overrides,
  }
}
