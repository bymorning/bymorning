export * as PluginHost from "./host.js"

import type { App } from "@bymorning/plugin/app"
import type { Context as PluginContext, WorkspaceContext } from "@bymorning/plugin/effect/plugin"
import type { IntegrationMethod, IntegrationMethodRegistration } from "@bymorning/plugin/effect/integration"
import type { PluginOptions } from "@bymorning/plugin/options"
import type { SessionHooks } from "@bymorning/plugin/effect/session"
import type { GatewayHooks, GatewayFailures } from "@bymorning/plugin/effect/gateway"
import type { SessionInvocation, GatewayInvocation } from "@bymorning/plugin/effect/model"
import type { ModelHookOptions } from "@bymorning/plugin/effect/registration"
import type { ModelError } from "@bymorning/schema/plugin-model"
import { AgentSchema } from "@bymorning/schema/agent"
import { AgentEvent } from "@bymorning/schema/agent-event"
import { Config } from "@bymorning/schema/config"
import { Credential } from "@bymorning/schema/credential"
import { AttemptID, ID, MethodID } from "@bymorning/schema/integration"
import { Reference } from "@bymorning/schema/reference"
import { SkillSchema } from "@bymorning/schema/skill"
import { Workspace } from "@bymorning/schema/workspace"
import { CodeInterpreterSchema } from "@bymorning/schema/code-interpreter"
import { Plugin } from "@bymorning/schema/plugin"
import type { Account } from "@bymorning/schema/account"
import { Cause, Effect, Exit, Option, Schema, Stream, Types, type Scope } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Agent } from "../agent.js"
import { AISDK } from "../aisdk.js"
import { Bus } from "../bus.js"
import { Catalog } from "../catalog.js"
import { Command } from "../command.js"
import { Integration } from "../integration.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { IntegrationOAuthCallback } from "../integration-oauth-callback.js"
import { Mcp } from "../mcp.js"
import { Form } from "../form.js"
import {
  AwsSigV4MethodDefinition,
  CommandMethodDefinition,
  EnvMethodDefinition,
  EnvGroupMethodDefinition,
  KeyMethodDefinition,
  type Implementation,
  type MethodSelector,
  OAuthMethodDefinition,
} from "../integration/definition.js"
import type { Interface as ReferenceInterface } from "../reference.js"
import { Skill } from "../skill.js"
import { Storage } from "../storage.js"
import { Tool } from "../tool.js"
import { CodeModeTool } from "../codemode/tool.js"
import type { State } from "../state.js"
import { WebSearch } from "../websearch.js"
import { CodeInterpreter } from "../code-interpreter.js"
import { PluginHooks } from "./hooks.js"
import { PluginRuntime } from "./runtime.js"
import type { Interface as PluginRegistryInterface } from "../plugin.js"

export interface PluginRegistry {
  readonly activate: PluginRegistryInterface["activate"]
  // @effect-diagnostics-next-line lazyEffect:off
  readonly list: () => Effect.Effect<import("@bymorning/schema/plugin").Plugin.Info[]>
}

/** Exact Workspace identities captured by one public plugin capability host. */
export interface HostServices {
  readonly http: HttpClient.HttpClient
  readonly workspaceID: Workspace.ID
  readonly accountID?: Account.ID
  readonly app: App
  readonly agent: Agent.Interface
  readonly aisdk: AISDK.Interface
  readonly catalog: Catalog.Interface
  readonly command: Command.Interface
  readonly bus: Bus.Interface
  readonly integration: Integration.Interface
  readonly instruction: InstructionDiscovery.Interface
  readonly integrationOAuthCallback?: IntegrationOAuthCallback.Interface
  readonly mcp: Mcp.Interface
  readonly plugin: PluginRegistry
  readonly reference: ReferenceInterface
  readonly runtime: PluginRuntime.Interface
  readonly shellHooks: PluginHooks.Interface
  readonly skill: Skill.Interface
  readonly storage: Storage.Interface
  readonly tool: Tool.Interface
  readonly websearch: WebSearch.Interface
  readonly codeInterpreter?: CodeInterpreter.Interface
}

/** Capabilities available to a caller-less Workspace activation. */
export interface WorkspaceHost {
  readonly scope: "workspace"
  readonly workspaceID: Workspace.ID
  readonly app: App
  readonly catalog: Catalog.Interface
  readonly shellHooks: PluginHooks.Interface
  readonly storage: Storage.Interface
}

/** Construct the reduced host without accessing member services. */
export function workspace(services: WorkspaceHost, pluginID: string, options: PluginOptions): WorkspaceContext {
  return {
    app: services.app,
    location: { workspaceID: services.workspaceID },
    options,
    catalog: {
      provider: { list: () => services.catalog.provider.available() },
      model: { list: () => services.catalog.model.available() },
      transform: services.catalog.transform,
      reload: services.catalog.reload,
    },
    gateway: { hook: gatewayHook(services.shellHooks) },
    session: { hook: sessionHook(services.shellHooks) },
    tool: { hook: (name, callback) => services.shellHooks.register("tool", name, callback) },
    storage: services.storage.scope({ workspaceID: services.workspaceID, pluginID }),
  }
}

/**
 * Plugin-supplied input the host cannot accept, such as a malformed Integration method.
 * It fails the supplying plugin alone; the registry reports `message` as that plugin's error.
 */
export class InputError extends Schema.TaggedError<InputError>()("PluginHost.InputError", {
  pluginID: Schema.String,
  message: Schema.String,
}) {}

/** Decode one plugin-supplied value, rejecting it as that plugin's InputError. */
const admit = <S extends Schema.ConstraintDecoder<unknown>>(
  pluginID: string,
  subject: string,
  schema: S,
  value: unknown,
): S["Type"] => {
  const decoded = Schema.decodeUnknownExit(schema)(value)
  if (Exit.isSuccess(decoded)) return decoded.value
  const error = Cause.squash(decoded.cause)
  throw new InputError({
    pluginID,
    message: `Invalid ${subject}: ${error instanceof Error ? error.message : String(error)}`,
  })
}

/** Effect form of `admit` for plugin calls whose public error channel is open. */
const admitEffect = <S extends Schema.ConstraintDecoder<unknown>>(
  pluginID: string,
  subject: string,
  schema: S,
  value: unknown,
) =>
  Effect.try({
    try: () => admit(pluginID, subject, schema, value),
    catch: (error) => error as InputError,
  })

/** Private contribution index for one loaded plugin activation. */
export interface Contribution {
  readonly integrations: Map<object, Set<ID>>
  readonly tools: Map<object, Set<string>>
}

/** Adapt one permanently-bound Workspace graph into the vendored public Plugin Context. */
export function make(
  services: HostServices,
  pluginID: string = "test",
  options: PluginOptions = {},
  source?: Plugin.Source,
  contribution?: Contribution,
): PluginContext {
  const context = {
    app: services.app,
    location: {
      workspaceID: services.workspaceID,
      ...(source?.type === "project" ? { projectID: source.projectID } : {}),
    },
    options,
    agent: {
      list: () => services.agent.list,
      get: (input) =>
        services.agent
          .get(AgentSchema.ID.make(input.id))
          .pipe(
            Effect.flatMap((agent) =>
              agent === undefined
                ? Effect.fail(new Agent.NotFoundError({ id: AgentSchema.ID.make(input.id) }))
                : Effect.succeed(agent),
            ),
          ),
      create: (input) => services.agent.create(AgentSchema.Info.make(input)),
      update: (input) => services.agent.update(AgentSchema.ID.make(input.id), input),
      delete: (input) => services.agent.delete(AgentSchema.ID.make(input.id)),
      transform: (callback) =>
        services.agent.transform((editor) =>
          callback({
            list: () => mutable(editor.list()),
            get: (id) => mutable(editor.get(id)),
            default: editor.default,
            update: editor.update,
            remove: editor.remove,
          }),
        ),
      reload: services.agent.reload,
    },
    aisdk: { hook: services.aisdk.hook },
    catalog: {
      provider: {
        list: () => services.catalog.provider.available(),
      },
      model: {
        list: () => services.catalog.model.available(),
      },
      transform: services.catalog.transform,
      reload: services.catalog.reload,
    },
    command: {
      list: () => services.command.list(),
      transform: services.command.transform,
      reload: services.command.reload,
    },
    event: {
      subscribe: () => Stream.unwrap(services.bus.subscribe(PluginEvents)),
    },
    gateway: { hook: gatewayHook(services.shellHooks) },
    integration: {
      list: () => services.integration.list(),
      get: (input) => services.integration.get(ID.make(input.integrationID)),
      connect: {
        key: (input) => {
          if (input.answer !== undefined && input.configuration !== undefined) {
            return Effect.die(new Error("Specify either answer or configuration"))
          }
          return services.integration.connection.key({
            integrationID: ID.make(input.integrationID),
            key: input.key,
            label: input.label,
            scope: input.scope,
            answer: input.configuration === undefined ? input.answer : { region: input.configuration.region },
          })
        },
        awsSigV4: (input) => {
          if (input.methodID !== undefined && input.methodID !== Integration.BedrockAwsSigV4MethodID) {
            return Effect.die(new Error("AWS SigV4 method not found"))
          }
          return services.integration.connection.awsSigV4({
            integrationID: ID.make(input.integrationID),
            accessKeyId: input.accessKeyId,
            secretAccessKey: input.secretAccessKey,
            sessionToken: input.sessionToken,
            region: input.region,
            label: input.label,
            scope: input.scope,
          })
        },
      },
      oauth: {
        callback: {
          register: () => {
            if (!services.accountID || !services.integrationOAuthCallback) {
              return Effect.die(new Error("Integration OAuth callbacks are unavailable"))
            }
            return services.integrationOAuthCallback.register({
              accountID: services.accountID,
              workspaceID: services.workspaceID,
              pluginID,
            })
          },
        },
        connect: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.oauth.connect({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              methodID: yield* admitEffect(pluginID, "integration method ID", MethodID, input.methodID),
              answer: input.answer,
              label: input.label,
              scope: input.scope,
            })
          }),
        status: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.oauth.status({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              attemptID: yield* admitEffect(pluginID, "integration attempt ID", AttemptID, input.attemptID),
            })
          }),
        complete: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.oauth.complete({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              attemptID: yield* admitEffect(pluginID, "integration attempt ID", AttemptID, input.attemptID),
              code: input.code,
            })
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.oauth.cancel({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              attemptID: yield* admitEffect(pluginID, "integration attempt ID", AttemptID, input.attemptID),
            })
          }),
      },
      command: {
        connect: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.command.connect({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              methodID: yield* admitEffect(pluginID, "integration method ID", MethodID, input.methodID),
              label: input.label,
              scope: input.scope,
            })
          }),
        status: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.command.status({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              attemptID: yield* admitEffect(pluginID, "integration attempt ID", AttemptID, input.attemptID),
            })
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            return yield* services.integration.command.cancel({
              integrationID: yield* admitEffect(pluginID, "integration ID", ID, input.integrationID),
              attemptID: yield* admitEffect(pluginID, "integration attempt ID", AttemptID, input.attemptID),
            })
          }),
      },
      connection: {
        active: (id) => services.integration.connection.active(ID.make(id)),
        resolve: (connection) => {
          // Regional connections are display-only for external plugins; AWS credential material stays host-owned.
          if (connection.type === "regional-credential" || connection.type === "regional-env") {
            return Effect.succeed(Option.getOrUndefined(Option.none<Credential.Value>()))
          }
          return services.integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          )
        },
      },
      transform: (callback) => {
        const ids = new Set<ID>()
        const integrationID = (id: unknown) => admit(pluginID, "integration ID", ID, id)
        return track(
          services.integration.transform((editor) => {
            ids.clear()
            callback({
              list: () => mutable(editor.list()),
              get: (id) => mutable(editor.get(integrationID(id))),
              update: (id, update) => {
                editor.update(integrationID(id), update)
                ids.add(integrationID(id))
              },
              remove: (id) => {
                editor.remove(integrationID(id))
                ids.delete(integrationID(id))
              },
              method: {
                list: (id) =>
                  editor.method.list(integrationID(id)).filter((method) => method.type !== "values").map((method) =>
                    method.type === "env-group"
                      ? {
                          id: method.id,
                          type: method.type,
                          authKind: method.authKind,
                          available: false,
                        }
                      : method,
                  ),
                update: (input) => {
                  const implementation = methodImplementation(
                    input,
                    pluginID,
                    pluginID.startsWith("core.provider.") && (source === undefined || source.type === "builtin"),
                  )
                  editor.method.update(implementation)
                  ids.add(implementation.integrationID)
                },
                remove: (id, method) => editor.method.remove(integrationID(id), methodSelector(method, pluginID)),
              },
            })
          }),
          contribution?.integrations,
          ids,
        )
      },
      reload: services.integration.reload,
    },
    instruction: {
      list: (projectID) =>
        services.instruction.list(projectID).pipe(Effect.map((files) => (Array.isArray(files) ? mutable(files) : []))),
      transform: (callback) =>
        services.instruction.transform((editor) =>
          callback({
            list: () => mutable(editor.list()),
            add: (file) => editor.add(admit(pluginID, "instruction file", InstructionDiscovery.File, file)),
            update: editor.update,
            remove: editor.remove,
            unavailable: editor.unavailable,
          }),
        ),
      reload: services.instruction.reload,
    },
    mcp: {
      list: services.mcp.servers,
      transform: (callback) => services.mcp.transform(callback),
      reload: services.mcp.reload,
    },
    plugin: { list: () => services.plugin.list() },
    reference: {
      list: () => services.reference.list(),
      transform: (callback) =>
        services.reference.transform((editor) =>
          callback({
            add: (name, source) => editor.add(name, admit(pluginID, `reference ${name}`, Reference.Source, source)),
            remove: editor.remove,
            list: editor.list,
            get: editor.get,
          }),
        ),
      reload: services.reference.reload,
    },
    session: {
      hook: sessionHook(services.shellHooks),
      create: (input) => services.runtime.session.create(input),
      get: (input) => services.runtime.session.get(input.sessionID),
      switchAgent: services.runtime.session.switchAgent,
      switchModel: services.runtime.session.switchModel,
      prompt: services.runtime.session.prompt,
      generate: (input) => services.runtime.session.generate(input).pipe(Effect.map((text) => ({ text }))),
      command: services.runtime.session.command,
      rename: services.runtime.session.rename,
      synthetic: services.runtime.session.synthetic,
      interrupt: (input) => services.runtime.session.interrupt(input.sessionID, "user"),
      wait: (input) => services.runtime.session.wait(input.sessionID),
    },
    shell: { hook: (name, callback) => services.shellHooks.register("shell", name, callback) },
    skill: {
      list: () => services.skill.list,
      get: (input) => services.skill.get(SkillSchema.ID.make(input.skillID)),
      create: (input) => services.skill.create(input),
      update: (input) => services.skill.update(SkillSchema.Info.make({ ...input, id: input.skillID })),
      delete: (input) => services.skill.delete(SkillSchema.ID.make(input.skillID)),
      transform: (callback) =>
        services.skill.transform((editor) =>
          callback({
            list: () => mutable(editor.list()),
            get: editor.get,
            add: (skill) => editor.add(admit(pluginID, "skill", SkillSchema.Info, skill)),
            update: editor.update,
            remove: editor.remove,
          }),
        ),
      reload: services.skill.reload,
    },
    storage: services.storage.scope({ workspaceID: services.workspaceID, pluginID }),
    tool: {
      openapi: (options): ReturnType<PluginContext["tool"]["openapi"]> =>
        Effect.gen(function* () {
          // An arbitrary application HttpClient may already follow redirects.
          // Construct the supported transport here, and pin its fetch policy at
          // execution (layerMergedContext alone permits caller-context overrides).
          const fetch = yield* FetchHttpClient.Fetch
          const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
          return yield* Tool.openapi({
            tool: context.tool,
            integration: services.integration,
            http: HttpClient.transformResponse(http, (effect) => effect.pipe(
              Effect.provideService(FetchHttpClient.Fetch, fetch),
              Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual", credentials: "omit" }),
            )),
            options,
          })
        }),
      transform: (callback) => {
        const paths = new Set<string>()
        const collect = ((editor) => {
          paths.clear()
          callback({
            list: editor.list,
            get: editor.get,
            namespace: editor.namespace,
            add: (tool) => {
              const previous = new Set(editor.list())
              editor.add(tool)
              for (const admitted of editor.list())
                if (!previous.has(admitted)) paths.add(CodeModeTool.path(admitted))
            },
            update: (id, update) => {
              const previous = editor.get(id)
              editor.update(id, update)
              const admitted = editor.get(id)
              if (admitted !== undefined && admitted !== previous) paths.add(CodeModeTool.path(admitted))
            },
            remove: (id) => {
              const tool = editor.get(id)
              editor.remove(id)
              if (tool !== undefined) paths.delete(CodeModeTool.path(tool))
            },
          })
        }) as Parameters<PluginContext["tool"]["transform"]>[0]
        return track(
          Tool.withSource(services.tool.transform(collect), source ?? { type: "builtin" }, services.workspaceID),
          contribution?.tools,
          paths,
        )
      },
      reload: services.tool.reload,
      hook: (name, callback) => services.shellHooks.register("tool", name, callback),
    },
    websearch: {
      providers: () => services.websearch.providers(),
      query: (input) => services.websearch.query(input),
      transform: services.websearch.transform,
      reload: services.websearch.reload,
    },
    codeInterpreter: {
      transform: (callback) =>
        services.codeInterpreter === undefined
          ? Effect.die(new Error("Code Interpreter is unavailable"))
          : services.codeInterpreter.transform((editor) =>
              callback({
                add: ({ id, name, open }) =>
                  editor.add({
                    id,
                    name,
                    open: open.pipe(
                      Effect.map((executor) => ({
                        execute: (input) =>
                          executor.execute(input).pipe(
                            Effect.flatMap(Schema.decodeUnknownEffect(CodeInterpreterSchema.Output)),
                            Effect.mapError((cause) =>
                              cause instanceof CodeInterpreterSchema.ExecutionError
                                ? cause
                                : new CodeInterpreterSchema.ExecutionError({
                                    operation: "invoke",
                                    message: "Code Interpreter plugin returned invalid output",
                                    cause,
                                  }),
                            ),
                          ),
                      })),
                    ),
                  }),
                default: editor.default,
              }),
            ),
      reload: () => services.codeInterpreter === undefined ? Effect.void : services.codeInterpreter.reload(),
    },
  } as PluginContext
  return context
}

const track = <A extends string, E, R>(
  effect: Effect.Effect<State.Registration, E, R>,
  entries: Map<object, Set<A>> | undefined,
  values: Set<A>,
) =>
  Effect.gen(function* () {
    const registration = yield* effect
    if (!entries) return registration
    const token = {}
    const remove = Effect.sync(() => {
      entries.delete(token)
    })
    entries.set(token, values)
    yield* Effect.addFinalizer(() => remove)
    return { dispose: registration.dispose.pipe(Effect.ensuring(remove)) }
  })

const mutable = <A>(value: A) => value as Types.DeepMutable<A>

// The overloads preserve name/callback correlation at the public boundary. The
// implementation narrows the name before restoring its corresponding callback.
const sessionHook = (hooks: PluginHooks.Interface): WorkspaceContext["session"]["hook"] => (
  name: keyof SessionHooks | "model.invoke",
  callback: (event: never) => Effect.Effect<void, ModelError, Scope.Scope>,
  options?: ModelHookOptions,
) => name === "model.invoke"
  ? hooks.register("session", name, callback as (event: SessionInvocation) => Effect.Effect<void, ModelError, Scope.Scope>)
  : hooks.register("session", name, callback as (event: SessionHooks[keyof SessionHooks]) => Effect.Effect<void>, options)

const gatewayHook = (hooks: PluginHooks.Interface): WorkspaceContext["gateway"]["hook"] => (
  name: keyof GatewayHooks | "model.invoke",
  callback: (event: never) => Effect.Effect<void, unknown, Scope.Scope>,
) => name === "model.invoke"
  ? hooks.register("gateway", name, callback as (event: GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>)
  : hooks.register("gateway", name, callback as (event: GatewayHooks[keyof GatewayHooks]) => Effect.Effect<void, GatewayFailures[keyof GatewayHooks]>)

/** The only live Workspace events exposed to plugin code. */
const PluginEvents = [
  ...AgentEvent.Definitions,
  ...Plugin.Event.Definitions,
  ...Integration.Event.Definitions,
  ...Config.Event.Definitions,
] as const

const OAuthAuthorizationDetails = Schema.Struct({
  url: Schema.String,
  instructions: Schema.String,
  expiresAt: Schema.optional(Schema.Finite),
  mode: Schema.Literals(["auto", "code"]),
})

/** Read one field of untrusted plugin input without trusting its declared type. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined

/**
 * Admit one plugin-supplied Integration method by its declared type. Malformed, unknown, or
 * host-owned methods are the registering plugin's InputError, never a different method's decode.
 */
function methodImplementation(
  input:
    | IntegrationMethodRegistration
    | {
        readonly integrationID: string
        readonly method: Integration.AwsSigV4Method | Integration.EnvGroupMethod
      },
  pluginID: string,
  allowHostOwned = false,
): Implementation {
  const reject = (message: string) => new InputError({ pluginID, message })
  const declared = field(input, "method")
  if (typeof declared !== "object" || declared === null)
    throw reject(`Integration method for integration ${String(input.integrationID)} must be an object`)
  const integrationID = admit(pluginID, "integration ID", ID, input.integrationID)
  const type = field(declared, "type")
  const id = field(declared, "id")
  const method = (definition: string) =>
    `${definition} method${typeof id === "string" ? ` ${id}` : ""} for integration ${integrationID}`
  switch (type) {
    case "aws-sigv4":
    case "env-group": {
      if (!allowHostOwned) throw reject(`Integration method type "${type}" is host-owned; plugin ${pluginID} cannot register it`)
      return type === "aws-sigv4"
        ? { integrationID, method: admit(pluginID, method("AWS SigV4"), AwsSigV4MethodDefinition, input.method) }
        : { integrationID, method: admit(pluginID, method("Environment group"), EnvGroupMethodDefinition, input.method) }
    }
    case "oauth": {
      if (!("authorize" in input) || typeof field(input, "authorize") !== "function")
        throw reject(`${method("OAuth")} needs an authorize function`)
      const registration = input
      const refresh = registration.refresh
      const definition = admit(pluginID, method("OAuth"), OAuthMethodDefinition, registration.method)
      const invalidClient = definition.client && Form.validateFields(definition.client)
      if (invalidClient) throw reject(`Invalid OAuth client form for ${method("OAuth")}: ${invalidClient}`)
      return {
        integrationID,
        method: definition,
        authorize: (answer, clientAnswer) =>
          registration.authorize(answer, clientAnswer).pipe(
            Effect.flatMap((authorization) =>
              Schema.decodeUnknownEffect(OAuthAuthorizationDetails)(authorization).pipe(
                Effect.map((details) =>
                  authorization.mode === "auto"
                    ? {
                        ...details,
                        mode: "auto" as const,
                        callback: authorization.callback.pipe(
                          Effect.flatMap(Schema.decodeUnknownEffect(Credential.OAuth)),
                        ),
                      }
                    : {
                        ...details,
                        mode: "code" as const,
                        callback: (code: string) =>
                          authorization.callback(code).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Credential.OAuth))),
                      },
                ),
              ),
            ),
          ),
        ...(refresh === undefined
          ? {}
          : {
              refresh: (credential: Credential.OAuth, clientAnswer) =>
                refresh(credential, clientAnswer).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Credential.OAuth))),
            }),
        ...(registration.label === undefined ? {} : { label: registration.label }),
      }
    }
    case "command":
      return { integrationID, method: admit(pluginID, method("Command"), CommandMethodDefinition, input.method) }
    case "key":
      return { integrationID, method: admit(pluginID, method("Key"), KeyMethodDefinition, input.method) }
    case "env":
      return { integrationID, method: admit(pluginID, method("Environment"), EnvMethodDefinition, input.method) }
    default:
      throw reject(
        `Unknown method type ${JSON.stringify(type) ?? "undefined"} for ${method("Integration")}; expected oauth, key, command, or env`,
      )
  }
}

function methodSelector(method: IntegrationMethod, pluginID: string): MethodSelector {
  switch (method.type) {
    case "oauth":
    case "command":
    case "aws-sigv4":
    case "env-group":
      return { type: method.type, id: admit(pluginID, "integration method ID", MethodID, method.id) }
    case "key":
    case "env":
      return { type: method.type }
    default:
      throw new InputError({
        pluginID,
        message: `Unknown integration method type ${JSON.stringify(field(method, "type")) ?? "undefined"}`,
      })
  }
}
