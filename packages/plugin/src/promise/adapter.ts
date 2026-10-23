import { AgentSchema } from "@bymorning/schema/agent"
import { ModelSchema } from "@bymorning/schema/model"
import { SessionSchema } from "@bymorning/schema/session"
import { Tool } from "@bymorning/schema/tool"
import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect, Schema, SchemaAST, Scope, Stream } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/unstable/httpapi"
import { AsyncLocalStorage } from "node:async_hooks"
import { define } from "../effect/plugin.js"
import type { Context, Plugin } from "./plugin.js"
import type { IntegrationOAuthAuthorization } from "./integration.js"
import type { Info } from "./tool.js"
import type { WorkspaceContext } from "./plugin.js"
import type { WorkspaceContext as EffectWorkspace } from "../effect/plugin.js"
import { invoke, result as modelResult } from "./model-adapter.js"
import type { SessionHooks } from "../session-hooks.js"
import type { ModelHookOptions } from "./registration.js"

type HostRegistration = { readonly dispose: Effect.Effect<void> }
type Registration = { readonly dispose: () => Promise<void> }
type PromiseEvent = ReturnType<Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never

interface CompiledEndpoint {
  readonly decode: ReadonlyArray<(input: unknown) => Effect.Effect<unknown, Schema.SchemaError>>
  readonly encode: (output: unknown) => Effect.Effect<unknown, Schema.SchemaError>
  readonly noContent: boolean
}

const compiledEndpoints = new WeakMap<object, CompiledEndpoint>()
const ChildSessionCreateInput = Schema.Struct({
  parentID: SessionSchema.ID,
  title: Schema.optionalKey(SessionSchema.Title),
  agent: Schema.optionalKey(AgentSchema.ID),
  model: Schema.optionalKey(ModelSchema.Ref),
})

function compileEndpoint(endpoint: HttpApiEndpoint.Top, additionalPayload?: Schema.Top) {
  const cached = additionalPayload === undefined ? compiledEndpoints.get(endpoint) : undefined
  if (cached) return cached
  const payloadSchemas = Array.from(endpoint.payload.values()).flatMap(({ schemas }) => schemas)
  const successSchemas = Array.from(endpoint.success)
  if (payloadSchemas.length > 1 || successSchemas.length > 1) {
    throw new Error(`Unsupported API schema cardinality: ${endpoint.identifier}`)
  }
  const endpointPayload = payloadSchemas[0]
  const payload =
    additionalPayload === undefined
      ? endpointPayload
      : endpointPayload === undefined
        ? additionalPayload
        : Schema.Union([additionalPayload, endpointPayload])
  const inputs = [
    endpoint.params,
    endpoint.query === undefined ? undefined : Schema.toType(endpoint.query),
    endpoint.headers,
    payload,
  ].filter((schema): schema is Schema.Top => schema !== undefined) as Array<RuntimeSchema>
  const success = (successSchemas[0] ?? HttpApiSchema.NoContent) as RuntimeSchema
  const noContent = HttpApiSchema.isNoContent(success.ast)
  const type = Schema.toType(success).ast
  const data = SchemaAST.isObjects(success.ast)
    ? success.ast.propertySignatures.find((property) => property.name === "data")
    : undefined
  const output =
    !noContent &&
    SchemaAST.isObjects(type) &&
    type.indexSignatures.length === 0 &&
    type.propertySignatures.length === 1 &&
    type.propertySignatures[0]?.name === "data" &&
    data !== undefined
      ? (Schema.make<Schema.Top>(data.type) as RuntimeSchema)
      : success
  const compiled = {
    decode: inputs.map((schema) => Schema.decodeUnknownEffect(schema)),
    encode: Schema.encodeUnknownEffect(output),
    noContent,
  } satisfies CompiledEndpoint
  if (additionalPayload === undefined) compiledEndpoints.set(endpoint, compiled)
  return compiled
}

/**
 * Adapts a Promise plugin into an Effect plugin so the existing Effect-only
 * loader (`Plugin` / `PluginSupervisor`) can run it unchanged.
 *
 * Hook registrations created during the async `setup` attach to the plugin's
 * scope, so unloading the plugin disposes them. The captured fiber context
 * preserves boot-time batching, so Promise-plugin transforms still coalesce
 * into one reload per domain.
 */
export function fromPromise(plugin: Plugin) {
  if (plugin.scope === "workspace") {
    return define({
      id: plugin.id,
      scope: "workspace",
      tui: plugin.tui,
      configuration: plugin.configuration,
      effect: (host) => Effect.gen(function* () {
        const context = yield* common(host, plugin.id)
        const cleanup = yield* Effect.promise(() => Promise.resolve(plugin.setup(context)))
        if (cleanup) yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())))
      }),
    })
  }
  return define({
    id: plugin.id,
    scope: plugin.scope,
    tui: plugin.tui,
    configuration: plugin.configuration,
    effect: (host) =>
      Effect.gen(function* () {
        const [{ Api: ClientApi }, { WorkspaceEvent }] = yield* Effect.promise(() =>
          Promise.all([import("@bymorning/protocol/api"), import("@bymorning/schema/workspace-event")]),
        )
        const AgentEndpoints = ClientApi.groups["api.agent"].endpoints
        const CommandEndpoints = ClientApi.groups["api.command"].endpoints
        const IntegrationEndpoints = ClientApi.groups["api.integration"].endpoints
        const ReferenceEndpoints = ClientApi.groups["api.reference"].endpoints
        const SessionEndpoints = ClientApi.groups["api.session"].endpoints
        const SkillEndpoints = ClientApi.groups["api.skill"].endpoints
        const WebSearchEndpoints = ClientApi.groups["api.websearch"].endpoints
        const scope = yield* Scope.Scope
        const context = yield* Effect.context<Scope.Scope>()
        const authorizationScopes = new AsyncLocalStorage<Scope.Scope>()

        // Run a hook registration on the plugin scope and resolve once it is registered.
        const register = (effect: Effect.Effect<HostRegistration, never, Scope.Scope>): Promise<Registration> =>
          Effect.runPromiseWith(context)(Scope.provide(scope)(effect)).then((registration) => ({
            dispose: () => Effect.runPromiseWith(context)(registration.dispose),
          }))

        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect)

        const adaptApiMethod = <PromiseMethod>(
          endpoint: HttpApiEndpoint.Top,
          method: (input: never) => Effect.Effect<unknown, unknown>,
          additionalPayload?: Schema.Top,
        ) => {
          const compiled = compileEndpoint(endpoint, additionalPayload)
          return ((input?: unknown) =>
            Effect.gen(function* () {
              const decoded = yield* Effect.forEach(compiled.decode, (decode) => decode(input ?? {}))
              const result = yield* method(Object.assign({}, ...decoded) as never)
              if (compiled.noContent) return undefined
              return yield* compiled.encode(result)
            }).pipe(Effect.runPromiseWith(context))) as PromiseMethod
        }

        const transform =
          <Editor>(domain: {
            transform: (callback: (editor: Editor) => void) => Effect.Effect<HostRegistration, never, Scope.Scope>
          }) =>
          (callback: (editor: Editor) => void) =>
            register(
              domain.transform((editor) => {
                callback(editor)
              }),
            )

        const context2: Context = {
          app: host.app,
          location: host.location,
          options: host.options,
          agent: {
            get: adaptApiMethod(AgentEndpoints["agent.get"], host.agent.get),
            list: adaptApiMethod(AgentEndpoints["agent.list"], host.agent.list),
            create: adaptApiMethod(AgentEndpoints["agent.create"], host.agent.create),
            update: adaptApiMethod(AgentEndpoints["agent.update"], host.agent.update),
            delete: adaptApiMethod(AgentEndpoints["agent.delete"], host.agent.delete),
            transform: transform(host.agent),
            reload: () => run(host.agent.reload()),
          },
          aisdk: {
            hook: (name, callback, options) =>
              register(
                host.aisdk.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))), options),
              ),
          },
          catalog: {
            provider: {
              list: () => run(host.catalog.provider.list()),
            },
            model: {
              list: () => run(host.catalog.model.list()),
            },
            transform: transform(host.catalog),
            reload: () => run(host.catalog.reload()),
          },
          command: {
            list: adaptApiMethod(CommandEndpoints["command.list"], host.command.list),
            transform: transform(host.command),
            reload: () => run(host.command.reload()),
          },
          event: {
            subscribe: () =>
              Stream.toAsyncIterableWith(
                host.event.subscribe().pipe(
                  Stream.mapEffect((event) => Schema.encodeUnknownEffect(WorkspaceEvent.Item)(event)),
                  Stream.map((event) => event as unknown as PromiseEvent),
                ),
                context,
              ),
          },
          gateway: gateway(host.gateway, register, plugin.id),
          integration: {
            list: adaptApiMethod(IntegrationEndpoints["integration.list"], host.integration.list),
            get: adaptApiMethod(IntegrationEndpoints["integration.get"], host.integration.get),
            connect: {
              key: adaptApiMethod(IntegrationEndpoints["integration.connect.key"], host.integration.connect.key),
              awsSigV4: adaptApiMethod(
                IntegrationEndpoints["integration.connect.awsSigV4"],
                host.integration.connect.awsSigV4,
              ),
            },
            oauth: {
              callback: {
                register: () =>
                  Effect.runPromiseWith(context)(
                    Scope.provide(authorizationScopes.getStore() ?? scope)(host.integration.oauth.callback.register()),
                  ).then((registration) => ({
                    ...registration,
                    wait: run(registration.wait),
                  })),
              },
              connect: adaptApiMethod(
                IntegrationEndpoints["integration.oauth.connect"],
                host.integration.oauth.connect,
              ),
              status: adaptApiMethod(IntegrationEndpoints["integration.oauth.status"], host.integration.oauth.status),
              complete: adaptApiMethod(
                IntegrationEndpoints["integration.oauth.complete"],
                host.integration.oauth.complete,
              ),
              cancel: adaptApiMethod(IntegrationEndpoints["integration.oauth.cancel"], host.integration.oauth.cancel),
            },
            command: {
              connect: adaptApiMethod(
                IntegrationEndpoints["integration.command.connect"],
                host.integration.command.connect,
              ),
              status: adaptApiMethod(
                IntegrationEndpoints["integration.command.status"],
                host.integration.command.status,
              ),
              cancel: adaptApiMethod(
                IntegrationEndpoints["integration.command.cancel"],
                host.integration.command.cancel,
              ),
            },
            transform: (callback) =>
              register(
                host.integration.transform((editor) =>
                  callback({
                    list: editor.list,
                    get: editor.get,
                    update: editor.update,
                    remove: editor.remove,
                    method: {
                      list: editor.method.list,
                      update: (input) => {
                        if (!("authorize" in input)) return editor.method.update(input)
                        const refresh = input.refresh
                        editor.method.update({
                          ...input,
                          authorize: (answer, clientAnswer) =>
                            Effect.gen(function* () {
                              const authorizationScope = yield* Scope.Scope
                              return yield* Effect.promise((): Promise<IntegrationOAuthAuthorization> =>
                                authorizationScopes.run(authorizationScope, () =>
                                  input.authorize(answer, clientAnswer),
                                ),
                              )
                            }).pipe(
                              Effect.map((authorization) =>
                                authorization.mode === "auto"
                                  ? {
                                      ...authorization,
                                      callback: Effect.promise(() => authorization.callback),
                                    }
                                  : {
                                      ...authorization,
                                      callback: (code) => Effect.promise(() => authorization.callback(code)),
                                    },
                              ),
                            ),
                          refresh:
                            refresh === undefined
                              ? undefined
                              : (credential, clientAnswer) => Effect.promise(() => refresh(credential, clientAnswer)),
                        })
                      },
                      remove: editor.method.remove,
                    },
                  }),
                ),
              ),
            reload: () => run(host.integration.reload()),
            connection: {
              active: (id) => Effect.runPromiseWith(context)(host.integration.connection.active(id)),
              resolve: (connection) => Effect.runPromiseWith(context)(host.integration.connection.resolve(connection)),
            },
          },
          instruction: {
            list: (projectID) => run(host.instruction.list(projectID)),
            transform: transform(host.instruction),
            reload: () => run(host.instruction.reload()),
          },
          mcp: {
            list: () => run(host.mcp.list()),
            transform: transform(host.mcp),
            reload: () => run(host.mcp.reload()),
          },
          plugin: {
            list: () => run(host.plugin.list()),
          },
          reference: {
            list: adaptApiMethod(ReferenceEndpoints["reference.list"], host.reference.list),
            transform: transform(host.reference),
            reload: () => run(host.reference.reload()),
          },
          skill: {
            list: adaptApiMethod(SkillEndpoints["skill.list"], host.skill.list),
            get: adaptApiMethod(SkillEndpoints["skill.get"], host.skill.get),
            create: adaptApiMethod(SkillEndpoints["skill.create"], host.skill.create),
            update: adaptApiMethod(SkillEndpoints["skill.update"], host.skill.update),
            delete: adaptApiMethod(SkillEndpoints["skill.delete"], host.skill.delete),
            transform: transform(host.skill),
            reload: () => run(host.skill.reload()),
          },
          storage: {
            get: (key) => run(host.storage.get(key)),
            set: (key, value) => run(host.storage.set(key, value)),
            remove: (key) => run(host.storage.remove(key)),
            scan: (options) => run(host.storage.scan(options)),
          },
          tool: {
            openapi: async (options) => {
              const registration = await Effect.runPromiseWith(context)(
                Scope.provide(scope)(host.tool.openapi(options)),
              )
              return { ...registration, dispose: () => run(registration.dispose) }
            },
            transform: (callback) =>
              register(
                host.tool.transform((editor) =>
                  callback({
                    list: () => editor.list().map(promiseTool),
                    get: (id) => {
                      const tool = editor.get(id)
                      return tool === undefined ? undefined : promiseTool(tool)
                    },
                    namespace: editor.namespace,
                    remove: editor.remove,
                    update: (id, update) =>
                      editor.update(id, (tool) => {
                        const adapted = promiseTool(tool)
                        update(adapted)
                        Object.assign(tool, adapted, {
                          execute: (input: unknown, context: Tool.Context) =>
                            executePromiseTool(adapted, input, context),
                        })
                      }),
                    add: (tool: Info) => {
                      if (tool.execute === undefined) return editor.add(tool)
                      editor.add({
                        ...tool,
                        execute: (input, context) => executePromiseTool(tool, input, context),
                      })
                    },
                  }),
                ),
              ),
            hook: (name, callback) =>
              name === "execute.before"
                ? register(
                    host.tool.hook(name, (event) =>
                      Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))).pipe(
                        Effect.flatMap((result) => {
                          if (result === undefined) return Effect.void
                          if (result instanceof Tool.Error) return Effect.fail(result)
                          return Effect.die(new TypeError("Promise execute.before must return Tool.Error or undefined"))
                        }),
                      ),
                    ),
                  )
                : register(
                    host.tool.hook(name, (event) =>
                      Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))).pipe(
                        Effect.asVoid,
                      ),
                    ),
                  ),
            reload: () => run(host.tool.reload()),
          },
          websearch: {
            providers: adaptApiMethod(WebSearchEndpoints["websearch.providers"], host.websearch.providers),
            query: adaptApiMethod(WebSearchEndpoints["websearch.query"], host.websearch.query),
            reload: () => run(host.websearch.reload()),
            transform: (callback) =>
              register(
                host.websearch.transform((editor) => {
                  callback({
                    add: (definition) =>
                      editor.add({
                        id: definition.id,
                        name: definition.name,
                        execute: (input) => attempt((signal) => definition.execute(input, { signal })),
                      }),
                    default: editor.default,
                  })
                }),
              ),
          },
          codeInterpreter: {
            reload: () => run(host.codeInterpreter.reload()),
            transform: (callback) =>
              register(
                host.codeInterpreter.transform((editor) =>
                  callback({
                    add: (implementation) =>
                      editor.add({
                        id: implementation.id,
                        name: implementation.name,
                        open: Effect.tryPromise({
                          try: (signal) => implementation.open({ signal }),
                          catch: (cause) =>
                            new CodeInterpreter.ExecutionError({
                              operation: "start",
                              message: "Code Interpreter plugin failed to open",
                              cause,
                            }),
                        }).pipe(
                          Effect.map((executor) => ({
                            execute: (input) =>
                              Effect.tryPromise({
                                try: (signal) => executor.execute(input, { signal }),
                                catch: (cause) =>
                                  new CodeInterpreter.ExecutionError({
                                    operation: "invoke",
                                    message: "Code Interpreter plugin execution failed",
                                    cause,
                                  }),
                              }),
                          })),
                        ),
                      }),
                    default: editor.default,
                  }),
                ),
              ),
          },
          session: {
            hook: session(host.session, register, plugin.id).hook,
            create: adaptApiMethod(SessionEndpoints["session.create"], host.session.create, ChildSessionCreateInput),
            get: adaptApiMethod(SessionEndpoints["session.get"], host.session.get),
            switchAgent: adaptApiMethod(SessionEndpoints["session.switchAgent"], host.session.switchAgent),
            switchModel: adaptApiMethod(SessionEndpoints["session.switchModel"], host.session.switchModel),
            prompt: adaptApiMethod(SessionEndpoints["session.prompt"], host.session.prompt),
            generate: adaptApiMethod(SessionEndpoints["session.generate"], host.session.generate),
            command: adaptApiMethod(SessionEndpoints["session.command"], host.session.command),
            synthetic: adaptApiMethod(SessionEndpoints["session.synthetic"], host.session.synthetic),
            interrupt: adaptApiMethod(SessionEndpoints["session.interrupt"], host.session.interrupt),
            rename: adaptApiMethod(SessionEndpoints["session.rename"], host.session.rename),
            wait: adaptApiMethod(SessionEndpoints["session.wait"], host.session.wait),
          },
          shell: {
            hook: (name, callback) =>
              register(host.shell.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
        }

        const cleanup = yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
        if (!cleanup) return
        yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())))
      }),
  })
}

type Register = (effect: Effect.Effect<HostRegistration, never, Scope.Scope>) => Promise<Registration>

const session = (host: EffectWorkspace["session"], register: Register, pluginID: string): WorkspaceContext["session"] => ({
  hook: (name: keyof SessionHooks | "model.invoke", callback: (input: never) => unknown, options?: ModelHookOptions) => {
    if (name === "model.invoke") return register(host.hook(name, (event) =>
      invoke(pluginID, "session.model.invoke", (input) => Reflect.apply(callback, undefined, [input]), event),
    ))
    return register(host.hook(name, (event) =>
      Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))), options,
    ))
  },
})

const gateway = (host: EffectWorkspace["gateway"], register: Register, pluginID: string): WorkspaceContext["gateway"] => ({
  hook: (name, callback) => {
    if (name === "model.invoke") return register(host.hook(name, (event) =>
      invoke(pluginID, "gateway.model.invoke", (input) => Reflect.apply(callback, undefined, [input]), event),
    ))
    if (name === "model.request") return register(host.hook(name, (event) =>
      modelResult(pluginID, "gateway.model.request", () => Promise.resolve().then(() => Reflect.apply(callback, undefined, [event]))),
    ))
    if (name === "tool.execute.before") return register(host.hook(name, (event) =>
      Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))).pipe(
        Effect.flatMap((result) => {
          if (result === undefined) return Effect.void
          if (result instanceof Tool.Error) return Effect.fail(result)
          return Effect.die(new TypeError("Promise gateway tool.execute.before must return Tool.Error or undefined"))
        }),
      ),
    ))
    return register(host.hook(name, (event) =>
      Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))).pipe(Effect.asVoid),
    ))
  },
})

const common = Effect.fn("Plugin.workspaceAdapter")(function* (host: EffectWorkspace, pluginID: string) {
  const context = yield* Effect.context<Scope.Scope>()
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect)
  const register: Register = (effect) => Effect.runPromiseWith(context)(effect).then((registration) => ({
    dispose: () => run(registration.dispose),
  }))
  return {
    app: host.app,
    options: host.options,
    location: host.location,
    catalog: {
      provider: { list: () => run(host.catalog.provider.list()) },
      model: { list: () => run(host.catalog.model.list()) },
      transform: (callback) => register(host.catalog.transform(callback)),
      reload: () => run(host.catalog.reload()),
    },
    gateway: gateway(host.gateway, register, pluginID),
    session: session(host.session, register, pluginID),
    tool: {
      hook: (name, callback) => name === "execute.before"
        ? register(host.tool.hook(name, (event) => Effect.promise(() =>
          Promise.resolve(Reflect.apply(callback, undefined, [event])),
        ).pipe(Effect.flatMap((value) => {
          if (value === undefined) return Effect.void
          if (value instanceof Tool.Error) return Effect.fail(value)
          return Effect.die(new TypeError("Promise execute.before must return Tool.Error or undefined"))
        }))))
        : register(host.tool.hook(name, (event) => Effect.promise(() =>
          Promise.resolve(Reflect.apply(callback, undefined, [event])),
        ).pipe(Effect.asVoid))),
    },
    storage: {
      get: (key) => run(host.storage.get(key)),
      set: (key, value) => run(host.storage.set(key, value)),
      remove: (key) => run(host.storage.remove(key)),
      scan: (options) => run(host.storage.scan(options)),
    },
  } satisfies WorkspaceContext
})

function attempt<A>(evaluate: (signal: AbortSignal) => PromiseLike<A>) {
  return Effect.tryPromise({ try: evaluate, catch: (cause) => cause })
}

type RuntimeSchema = Schema.Codec<unknown, unknown>

const executePromiseTool = (
  tool: Exclude<Info, { readonly execution: "sandbox" }>,
  input: any,
  context: Tool.Context,
) =>
  Effect.tryPromise({
    try: () =>
      tool.execute(input, {
        ...context,
        progress: (update) => Effect.runPromise(context.progress(update)),
        permission: (request) => Effect.runPromise(context.permission(request)),
      }),
    catch: (error) =>
      error instanceof Tool.Error
        ? error
        : new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
  })

const promiseTool = <A extends Tool.Info>(
  tool: A,
): Omit<A, "execute"> & {
  execute: (input: unknown, context: import("./tool.js").ToolContext) => Promise<Tool.Result>
} => {
  const execute = tool.execute
  return {
    ...tool,
    execute: (input: unknown, context: import("./tool.js").ToolContext) =>
      Effect.runPromise(
        execute(input, {
          ...context,
          progress: (value) => Effect.promise(() => context.progress(value)),
          permission: (request) =>
            Effect.tryPromise({
              try: () => context.permission(request),
              catch: (error) =>
                error instanceof Tool.Error
                  ? error
                  : new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
            }),
        }),
      ),
  }
}
