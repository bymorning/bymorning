import type { Editor as MCPEditor } from "@bymorning/plugin/effect/mcp"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Event } from "@bymorning/schema/outbound-mcp"
import { Cause, Context, Deferred, Effect, Exit, FiberSet, Layer, Ref, Schema, Scope, Semaphore, Stream } from "effect"
import type { Session } from "@bymorning/schema/session"
import type { Tool } from "@bymorning/schema/tool"
import { Bus } from "../bus.js"
import { Credential } from "../credential.js"
import { Actor } from "../actor.js"
import { IntegrationOAuthCallback } from "../integration-oauth-callback.js"
import { Integration } from "../integration.js"
import { State } from "../state.js"
import { McpClient } from "./client.js"
import { McpOAuth } from "./oauth.js"
import { McpHeaders } from "./headers.js"
import { Account } from "../account.js"
import { createHash } from "node:crypto"
import { makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

type Descriptor =
  | {
      readonly type: "server"
      readonly config: ConfigMCP.Remote
      readonly inventory?: boolean
    }
  | { readonly type: "tombstone"; readonly config?: ConfigMCP.Remote }

export type Status =
  | { readonly status: "connected"; readonly integrationID?: string }
  | { readonly status: "pending"; readonly integrationID?: string }
  | { readonly status: "disabled"; readonly integrationID?: string }
  | { readonly status: "failed"; readonly error: string; readonly integrationID?: string }
  | { readonly status: "needs_auth"; readonly integrationID: string }

export type Server = Status & {
  readonly name: string
  readonly url?: string
  readonly enabled: boolean
  /** How members authenticate: the server's own OAuth, or Member Values. Absent when no member authenticates. */
  readonly auth?: "oauth" | "values"
}

/** A remote tool discovered from a connected MCP server. */
export interface RemoteTool {
  readonly server: string
  readonly name: string
  readonly action: string
  readonly description?: string
  readonly inputSchema?: unknown
  readonly outputSchema?: unknown
  readonly codemode?: boolean
}

export interface ToolResult {
  readonly isError?: boolean
  readonly structured?: unknown
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image" | "audio"; readonly mimeType: string; readonly data: string }
    | {
        readonly type: "resource"
        readonly uri: string
        readonly mimeType?: string
        readonly text?: string
        readonly blob?: string
      }
  >
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Mcp.NotFoundError", {
  server: Schema.String,
}) {}

export class ToolCallError extends Schema.TaggedError<ToolCallError>()("Mcp.ToolCallError", {
  server: Schema.String,
  message: Schema.String,
}) {}

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()("Mcp.AuthorizationError", {
  server: Schema.String,
  message: Schema.String,
}) {}

export type Editor = MCPEditor

export interface Interface extends State.Transformable<Editor> {
  // @effect-diagnostics-next-line lazyEffect:off
  readonly servers: () => Effect.Effect<ReadonlyArray<Server>>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly instructions: () => Effect.Effect<
    ReadonlyArray<{
      readonly server: string
      readonly instructions: string
      readonly codemode: boolean
    }>
  >
  readonly connect: (name: string) => Effect.Effect<void, NotFoundError>
  /** Complete a member's configured MCP OAuth flow and await its usable catalog. */
  readonly authorize: (input: {
    readonly server: string
    readonly elicit: Tool.Context["elicit"]
  }) => Effect.Effect<void, NotFoundError | AuthorizationError>
  readonly disconnect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly test: (
    name: string,
  ) => Effect.Effect<void, NotFoundError | McpClient.RequestError | McpClient.NeedsAuthError>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly tools: () => Effect.Effect<ReadonlyArray<RemoteTool>>
  readonly callTool: (input: {
    readonly server: string
    readonly name: string
    readonly args?: Record<string, unknown>
    readonly sessionID?: Session.ID
    readonly elicit?: Tool.Context["elicit"]
  }) => Effect.Effect<ToolResult, NotFoundError | ToolCallError | McpClient.NeedsAuthError>
}

export interface Dependencies {
  readonly integration: Integration.Interface
  readonly credential: Credential.Interface
  readonly oauthCallback: IntegrationOAuthCallback.Interface
  readonly owner: IntegrationOAuthCallback.Owner
  readonly bus: Bus.Interface
  /** Supplies the bound member's verified email for `${member.email}` header values. */
  readonly account: Account.Interface
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/Mcp") {}

export const identity = McpOAuth.identity

type Entry = {
  descriptor: Extract<Descriptor, { readonly type: "server" }>
  readonly scope: Scope.Closeable
  readonly connection: McpClient.Connection
  tools: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly inputSchema: unknown
    readonly outputSchema?: unknown
  }>
  readonly integrationID?: string
}

/** Own remote connections for one member-bound graph, independently of the
 * scopes that contribute configuration transforms. */
export const make = Effect.fn("Mcp.make")(function* (dependencies: Dependencies) {
  const workspace = yield* Scope.Scope
  const parent = yield* Scope.fork(workspace)
  const isClosed = () => parent.state._tag === "Closed"
  const fork = yield* FiberSet.makeRuntime<never, void>().pipe(Scope.provide(parent))
  const lock = Semaphore.makeUnsafe(1)
  const current = new Map<string, Entry>()
  const inventories = new Map<string, { readonly scope: Scope.Closeable; readonly key: string }>()
  const failures = new Map<string, { readonly error: string; readonly integrationID?: string }>()
  const overrides = new Map<string, { readonly enabled: boolean; readonly identity: string }>()
  const ready = new Map<string, Deferred.Deferred<void, AuthorizationError>>()
  let selected = new Map<string, Descriptor>()
  const statusSnapshot = yield* Ref.make<ReadonlyArray<Server>>([])
  let published = ""
  const publish = () => dependencies.bus.publish(Event.StatusChanged, {}).pipe(Effect.orDie)

  const publishChanged = Effect.fn("Mcp.publishChanged")(function* () {
    const snapshot = statuses(selected, current, failures, overrides)
    const next = JSON.stringify(snapshot)
    if (next === published) return
    published = next
    yield* Ref.set(statusSnapshot, snapshot)
    yield* publish()
  })

  const connectionClosed = Effect.fn("Mcp.connectionClosed")(function* (
    name: string,
    entry: Entry,
    error: McpClient.RequestError | McpClient.NeedsAuthError,
  ) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        if (current.get(name) !== entry) return
        current.delete(name)
        failures.set(name, {
          // After discovery, a values server refusing a request means it rejected the member's values.
          error:
            error._tag === "Mcp.NeedsAuthError" && McpHeaders.kind(entry.descriptor.config).type === "values"
              ? McpHeaders.rejected
              : failureMessage(error),
          ...(entry.integrationID === undefined ? {} : { integrationID: entry.integrationID }),
        })
        yield* Scope.close(entry.scope, Exit.void)
        yield* publishChanged()
        yield* dependencies.bus.publish(Event.ToolsChanged, {}).pipe(Effect.orDie)
      }),
    )
  })

  const refresh = Effect.fn("Mcp.refresh")(function* (name: string, entry: Entry) {
    if (current.get(name) !== entry) return
    const tools = yield* entry.connection
      .tools()
      .pipe(Effect.catch((error) => connectionClosed(name, entry, error).pipe(Effect.as(undefined))))
    if (tools === undefined) return
    yield* lock.withPermit(
      Effect.gen(function* () {
        if (current.get(name) !== entry) return
        entry.tools = tools
        yield* dependencies.bus.publish(Event.ToolsChanged, {}).pipe(Effect.orDie)
      }),
    )
  })

  const install = Effect.fn("Mcp.install")(function* (name: string, entry: Entry) {
    current.set(name, entry)
    failures.delete(name)
    entry.connection.onToolsChanged(() => {
      fork(refresh(name, entry))
    })
    const waiting = ready.get(name)
    if (waiting !== undefined) {
      ready.delete(name)
      yield* Deferred.succeed(waiting, undefined)
    }
    yield* entry.connection.closed.pipe(
      Effect.catch((error) => connectionClosed(name, entry, error)),
      Effect.forkIn(parent),
    )
  })

  const reconnect = (integrationID: Integration.ID) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (isClosed()) return
        // Integration's publisher delivers member mutations only to that member's
        // Bus. Re-resolve through this graph's Credential service, never event data.
        // Inspect the current winning configuration after acquiring the lock: edits
        // and operational disconnects may have superseded the queued notification.
        for (const [name, descriptor] of selected) {
          const config = descriptor.config
          if (config === undefined || McpHeaders.integrationID(name, config) !== integrationID) continue
          const override = overrides.get(name)
          const enabled = override?.identity === descriptorIdentity(name, descriptor) ? override.enabled : undefined
          if (enabled === false || descriptor.type === "tombstone") continue
          const previous = current.get(name)
          current.delete(name)
          failures.delete(name)
          if (previous !== undefined) yield* Scope.close(previous.scope, Exit.void)
          yield* publishChanged()
          yield* discoverServer(parent, dependencies, name, { type: "server", config }).pipe(
            Effect.flatMap((entry) => install(name, entry)),
            Effect.catch((error) =>
              Effect.sync(() => {
                failures.set(name, {
                  error: failureMessage(error),
                  integrationID,
                })
                const waiting = ready.get(name)
                if (waiting !== undefined) ready.delete(name)
                return waiting
              }).pipe(
                Effect.flatMap((waiting) =>
                  waiting === undefined
                    ? Effect.void
                    : Deferred.fail(
                        waiting,
                        new AuthorizationError({ server: name, message: "MCP connection failed after authorization" }),
                      ),
                ),
              ),
            ),
          )
          yield* publishChanged()
          yield* dependencies.bus.publish(Event.ToolsChanged, {}).pipe(Effect.orDie)
        }
      }),
    )

  const reconcile = lock.withPermit(
    Effect.gen(function* () {
      // Registration is deliberately delegated to the Tool composition adapter.
      if (isClosed()) return
      const desired = new Map<string, Extract<Descriptor, { readonly type: "server" }>>()
      selected = state.get()
      for (const [name, winner] of selected) {
        const identity = descriptorIdentity(name, winner)
        const override = overrides.get(name)
        if (override !== undefined && override.identity !== identity) overrides.delete(name)
        const enabled = override?.identity === identity ? override.enabled : undefined
        if (winner.type === "server" && enabled !== false) desired.set(name, winner)
      }
      for (const name of overrides.keys()) if (!selected.has(name)) overrides.delete(name)
      for (const [name, descriptor] of desired) {
        const previous = current.get(name)
        if (previous === undefined || JSON.stringify(previous.descriptor.config) !== JSON.stringify(descriptor.config))
          failures.delete(name)
      }
      yield* publishChanged()

      yield* Effect.forEach(
        [...inventories].filter(([name, inventory]) => {
          const descriptor = desired.get(name)
          return descriptor === undefined || inventory.key !== descriptorFingerprint(name, descriptor)
        }),
        ([name, inventory]) =>
          Scope.close(inventory.scope, Exit.void).pipe(Effect.tap(() => Effect.sync(() => inventories.delete(name)))),
        { discard: true },
      )
      for (const name of selected.keys()) if (!desired.has(name)) failures.delete(name)
      yield* Effect.forEach(
        [...desired].filter(
          ([name, descriptor]) =>
            (descriptor.inventory === true || McpHeaders.kind(descriptor.config).type !== "none") &&
            !inventories.has(name),
        ),
        ([name, descriptor]) =>
          Effect.gen(function* () {
            const scope = yield* Scope.fork(parent)
            inventories.set(name, { scope, key: descriptorFingerprint(name, descriptor) })
            const kind = McpHeaders.kind(descriptor.config).type
            if (kind === "values")
              yield* McpHeaders.register(dependencies.integration, name, descriptor.config).pipe(Scope.provide(scope))
            else if (descriptor.config.oauth === false)
              yield* dependencies.integration
                .transform((editor) => {
                  const integrationID = Integration.ID.make(name)
                  if (editor.get(integrationID) !== undefined) return
                  editor.update(integrationID, (integration) => (integration.name = name))
                })
                .pipe(Scope.provide(scope))
            if (kind === "oauth")
              yield* McpOAuth.register(
                dependencies.integration,
                dependencies.oauthCallback,
                dependencies.owner,
                name,
                descriptor.config,
              ).pipe(Scope.provide(scope))
          }),
        { discard: true },
      )

      yield* Effect.forEach(
        [...current].filter(([name]) => !desired.has(name)),
        ([name, entry]) =>
          Scope.close(entry.scope, Exit.void).pipe(Effect.tap(() => Effect.sync(() => current.delete(name)))),
        { discard: true },
      )

      const replacements = new Map<string, { readonly previous?: Entry; readonly next: Entry }>()
      yield* Effect.forEach(
        [...desired],
        ([name, descriptor]) => {
          const previous = current.get(name)
          if (
            previous !== undefined &&
            JSON.stringify(previous.descriptor.config) === JSON.stringify(descriptor.config)
          ) {
            previous.descriptor = descriptor
            return Effect.void
          }
          // A changed definition replaces availability, not just discovery.
          // Never leave a retired endpoint callable when its replacement fails.
          const retire =
            previous === undefined
              ? Effect.void
              : Effect.gen(function* () {
                  current.delete(name)
                  yield* Scope.close(previous.scope, Exit.void)
                })
          return retire.pipe(
            Effect.andThen(discoverServer(parent, dependencies, name, descriptor)),
            Effect.tap((next) => Effect.sync(() => replacements.set(name, { previous, next }))),
            Effect.catch((error) =>
              Effect.sync(() => {
                const integrationID = McpHeaders.integrationID(name, descriptor.config)
                failures.set(name, {
                  error: failureMessage(error),
                  ...(integrationID === undefined ? {} : { integrationID }),
                })
              }).pipe(Effect.andThen(Effect.logWarning("failed to configure remote MCP server", { server: name }))),
            ),
          )
        },
        { concurrency: "unbounded", discard: true },
      )

      for (const [name, replacement] of replacements) {
        yield* install(name, replacement.next)
      }
      yield* publishChanged()
      yield* dependencies.bus.publish(Event.ToolsChanged, {}).pipe(Effect.orDie)
    }),
  )

  const reconcileLock = Semaphore.makeUnsafe(1)
  const state = State.create({
    name: "mcp",
    initial: () => new Map<string, Descriptor>(),
    editor: makeEditor,
    // Upstream 429387d158: resource reconciliation runs outside State reads.
    notify: () => State.reconcile(parent, fork, () => reconcileLock.withPermit(reconcile)),
  })

  // Subscribe before make returns, not through the optional config plugin. OAuth
  // completion, activation, update, and removal all publish this one event.
  // Fork resource work so receiving an event never blocks its publisher, and
  // own both the subscription and reconnection fibers in the MCP scope.
  const connectionUpdates = yield* dependencies.bus.subscribe(Integration.Event.ConnectionUpdated)
  yield* connectionUpdates.pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        fork(reconnect(event.data.integrationID))
      }),
    ),
    Effect.forkIn(parent, { startImmediately: true }),
  )

  return {
    servers: () => Ref.get(statusSnapshot),
    instructions: () =>
      lock.withPermit(
        Effect.sync(() =>
          [...current].flatMap(([server, entry]) =>
            entry.connection.instructions === undefined
              ? []
              : [
                  {
                    server,
                    instructions: entry.connection.instructions,
                    codemode: entry.descriptor.config.codemode !== false,
                  },
                ],
          ),
        ),
      ),
    connect: (name) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            if (selected.get(name)?.type !== "server") return yield* new NotFoundError({ server: name })
            overrides.set(name, { enabled: true, identity: descriptorIdentity(name, selected.get(name)) })
            const entry = current.get(name)
            if (entry !== undefined) {
              current.delete(name)
              yield* Scope.close(entry.scope, Exit.void)
            }
          }),
        )
        .pipe(Effect.andThen(reconcile)),
    authorize: Effect.fn("Mcp.authorize")(function* ({ server, elicit }) {
      const descriptor = yield* lock.withPermit(Effect.sync(() => selected.get(server)))
      if (descriptor === undefined) return yield* new NotFoundError({ server })
      if (descriptor.config !== undefined && McpHeaders.kind(descriptor.config).type === "values")
        // Member Values are never collected through a conversation.
        return yield* new AuthorizationError({
          server,
          message: `${server} needs your own values. In ByMorning, open the command palette, choose Connect integration, select "${server} MCP", and save your values, then ask again.`,
        })
      if (descriptor.config === undefined || McpHeaders.kind(descriptor.config).type !== "oauth")
        return yield* new AuthorizationError({ server, message: "This MCP server does not support OAuth authorization" })
      const integrationID = Integration.ID.make(McpOAuth.identity(server, descriptor.config.url))
      const status = (yield* Ref.get(statusSnapshot)).find((item) => item.name === server)
      if (status?.status !== "needs_auth")
        return yield* new AuthorizationError({ server, message: "This MCP server does not currently require authorization" })
      const attempt = yield* dependencies.integration.oauth
        .connect({ integrationID, methodID: Integration.MethodID.make("oauth"), scope: "member" })
        .pipe(Effect.mapError(() => new AuthorizationError({ server, message: "Unable to start MCP authorization" })))
      const connected = yield* Deferred.make<void, AuthorizationError>()
      ready.set(server, connected)
      const waitForConnection = () =>
        Effect.raceFirst(
          Deferred.await(connected),
          Effect.sleep(Math.max(1, attempt.time.expires - Date.now())).pipe(
            Effect.andThen(
              Effect.fail(new AuthorizationError({ server, message: "MCP authorization expired before connection completed" })),
            ),
          ),
        )
      const abandon = Effect.gen(function* () {
        ready.delete(server)
        yield* dependencies.integration.oauth.cancel({ integrationID, attemptID: attempt.attemptID }).pipe(Effect.ignore)
      })
      const outcome = yield* Effect.raceFirst(
        // The browser callback owns Integration.oauth.complete. Calling it here before the
        // authorization code exists fails immediately, interrupts the elicitation, and cancels
        // its Form. Reconnection settles `connected` after that real callback persists a Credential.
        waitForConnection().pipe(Effect.as({ type: "complete" as const })),
        elicit({
          mode: "url",
          title: `Connect ${server}`,
          message: "Complete authorization in your browser.",
          url: attempt.url,
        }).pipe(
          Effect.map((result) => ({ type: "elicit" as const, result })),
          Effect.mapError(() => new AuthorizationError({ server, message: "MCP authorization interaction failed" })),
        ),
      ).pipe(Effect.tapError(() => abandon))
      if (outcome.type === "complete") return
      if (outcome.result.action === "accept") {
        // Acknowledging the URL is not OAuth completion. Wait for the callback
        // fibre, which owns code exchange, persistence, and catalog readiness.
        return yield* waitForConnection().pipe(Effect.tapError(() => abandon))
      }
      yield* dependencies.integration.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
      ready.delete(server)
      return yield* new AuthorizationError({
        server,
        message: outcome.result.action === "decline" ? "MCP authorization was declined" : "MCP authorization was cancelled",
      })
    }),
    disconnect: (name) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            if (!selected.has(name)) return yield* new NotFoundError({ server: name })
            overrides.set(name, { enabled: false, identity: descriptorIdentity(name, selected.get(name)) })
            failures.delete(name)
            const entry = current.get(name)
            if (entry !== undefined) {
              current.delete(name)
              yield* Scope.close(entry.scope, Exit.void)
            }
          }),
        )
        .pipe(Effect.andThen(reconcile)),
    test: (name) =>
      lock.withPermit(
        Effect.gen(function* () {
          const descriptor = selected.get(name)
          if (descriptor === undefined || descriptor.type !== "server")
            return yield* new NotFoundError({ server: name })
          const entry = current.get(name)
          if (entry !== undefined) return yield* entry.connection.ping()
          if (descriptor.config === undefined)
            return yield* new McpClient.RequestError({ message: "Server is not connected", cause: name })
          // No live connection: open a throwaway probe that performs the initialize handshake, then close it.
          const probe = yield* discoverServer(parent, dependencies, name, { type: "server", config: descriptor.config }).pipe(
            Effect.catchTag("Mcp.ValuesError", (error) =>
              Effect.fail(new McpClient.RequestError({ message: error.message, cause: name })),
            ),
          )
          yield* Scope.close(probe.scope, Exit.void)
        }),
      ),
    transform: state.transform,
    reload: state.reload,
    tools: () =>
      lock.withPermit(
        Effect.sync(() =>
          [...current].flatMap(([server, entry]) =>
            entry.tools.map((tool) => ({
              server,
              name: tool.name,
              action: toolAction(server, tool.name),
              ...(tool.description === undefined ? {} : { description: tool.description }),
              inputSchema: tool.inputSchema,
              ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
              codemode: entry.descriptor.config.codemode !== false,
            })),
          ),
        ),
      ),
    callTool: ({ server, name, args, sessionID, elicit }) =>
      Effect.gen(function* () {
        const entry = yield* lock.withPermit(Effect.sync(() => current.get(server)))
        if (entry === undefined) return yield* new NotFoundError({ server })
        const tool = entry.tools.find((candidate) => candidate.name === name)
        if (tool === undefined) return yield* new ToolCallError({ server, message: `Unknown tool: ${name}` })
        // Do not hold the reconciliation lock across a network call. Retirement
        // must be able to close the transport and interrupt its OAuth writes.
        const result = yield* entry.connection.call(name, args ?? {}, sessionID, elicit).pipe(
          Effect.catchTags({
            "Mcp.NeedsAuthError": (error) => Effect.fail(error),
            "Mcp.RequestError": (error) => Effect.fail(new ToolCallError({ server, message: error.message })),
          }),
        )
        return { isError: result.isError, structured: result.structured, content: result.content }
      }),
  } satisfies Interface
})

export const layer = (owner: IntegrationOAuthCallback.Owner) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const credential = yield* Credential.Service
      const oauthCallback = yield* IntegrationOAuthCallback.Service
      const bus = yield* Bus.Service
      const account = yield* Account.Service
      return yield* make({ integration, credential, oauthCallback, owner, bus, account })
    }),
  )

/** Workspace coordinator with persisted credentials and status invalidation. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.map(Actor.Binding.Service, ({ workspaceID, accountID }) =>
      layer({ workspaceID, accountID, pluginID: "bymorning.config.mcp" }),
    ),
  ),
  deps: [Actor.binding, Bus.node, Credential.node, Integration.node, IntegrationOAuthCallback.node, Account.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly credential: WorkspaceNode<Credential.Service, E>
  readonly integration: WorkspaceNode<Integration.Service, E>
  readonly oauthCallback: GlobalNode<IntegrationOAuthCallback.Service, E>
  readonly account: GlobalNode<Account.Service, E>
  readonly owner: IntegrationOAuthCallback.Owner
}) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(input.owner),
    deps: [input.bus, input.credential, input.integration, input.oauthCallback, input.account],
  })

function statuses(
  selected: ReadonlyMap<string, Descriptor>,
  current: ReadonlyMap<string, Entry>,
  failures: ReadonlyMap<string, { readonly error: string; readonly integrationID?: string }>,
  overrides: ReadonlyMap<string, { readonly enabled: boolean; readonly identity: string }>,
): ReadonlyArray<Server> {
  return [...selected]
    .map(([name, descriptor]) => {
      const url = descriptor.config?.url
      const kind = descriptor.config === undefined ? undefined : McpHeaders.kind(descriptor.config).type
      const named = {
        name,
        ...(url === undefined ? {} : { url }),
        ...(kind === "oauth" || kind === "values" ? { auth: kind } : {}),
      }
      const integrationID =
        descriptor.config === undefined ? undefined : McpHeaders.integrationID(name, descriptor.config)
      const override = overrides.get(name)
      const enabled = override?.identity === descriptorIdentity(name, descriptor) ? override.enabled : undefined
      const active = descriptor.type === "server"
      if (!active || enabled === false)
        return {
          ...named,
          enabled: active,
          status: "disabled" as const,
          ...(integrationID === undefined ? {} : { integrationID }),
        }
      const entry = current.get(name)
      if (entry !== undefined)
        return {
          ...named,
          enabled: true,
          status: "connected" as const,
          ...(entry.integrationID === undefined ? {} : { integrationID: entry.integrationID }),
        }
      const failed = failures.get(name)
      if (failed !== undefined)
        return failed.error === "Authentication required" && failed.integrationID !== undefined
          ? { ...named, enabled: true, status: "needs_auth" as const, integrationID: failed.integrationID }
          : {
              ...named,
              enabled: true,
              status: "failed" as const,
              error: failed.error,
              ...(failed.integrationID === undefined ? {} : { integrationID: failed.integrationID }),
            }
      return {
        ...named,
        enabled: true,
        status: "pending" as const,
        ...(integrationID === undefined ? {} : { integrationID }),
      }
    })
    .toSorted((left, right) => left.name.localeCompare(right.name))
}

const descriptorIdentity = (name: string, descriptor: Descriptor | undefined) =>
  descriptor?.config === undefined ? `${name}\0disabled` : `${name}\0${descriptor.config.url}`

const descriptorFingerprint = (name: string, descriptor: Extract<Descriptor, { readonly type: "server" }>) =>
  createHash("sha256").update(name).update("\0").update(JSON.stringify(descriptor.config)).digest("hex")

const toolAction = (server: string, tool: string) =>
  `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

function makeEditor(servers: Map<string, Descriptor>): MCPEditor {
  return {
    list: () =>
      [...servers].flatMap(([name, descriptor]) =>
        descriptor.config === undefined ? [] : [[name, descriptor.config]],
      ),
    get: (name) => servers.get(name)?.config,
    set: (name, config) => servers.set(name, fromConfig(structuredClone(config))),
    update: (name, update) => {
      const descriptor = servers.get(name)
      if (descriptor?.config === undefined) return
      update(descriptor.config)
      servers.set(name, fromConfig(descriptor.config, descriptor.type === "server" ? descriptor.inventory : true))
    },
    remove: (name) => {
      servers.delete(name)
    },
  }
}

const fromConfig = (config: ConfigMCP.Remote, inventory = true): Descriptor =>
  config.enabled === false || (config.enabled === undefined && config.disabled === true)
    ? { type: "tombstone", config }
    : { type: "server", config, inventory }

const discoverServer = Effect.fn("Mcp.discoverServer")(function* (
  parent: Scope.Closeable,
  dependencies: Dependencies,
  name: string,
  descriptor: Extract<Descriptor, { readonly type: "server" }>,
) {
  const scope = yield* Scope.fork(parent)
  return yield* Effect.gen(function* () {
    const config = descriptor.config
    const kind = McpHeaders.kind(config).type
    const integrationID = McpHeaders.integrationID(name, config)
    // Member values are resolved per connection on this member's graph and are
    // never written back into the descriptor, status, or events.
    const resolved = yield* McpHeaders.resolve({
      name,
      config,
      integration: dependencies.integration,
      account: dependencies.account,
      accountID: dependencies.owner.accountID,
    })
    if (resolved.type === "missing") return yield* new McpClient.NeedsAuthError({ server: name })
    const provider =
      kind !== "oauth" || integrationID === undefined
        ? undefined
        : yield* McpOAuth.connectionProvider(
            dependencies.integration,
            integrationID,
            config,
            dependencies.credential,
          ).pipe(
            Scope.provide(scope),
            Effect.mapError((error) => new McpClient.RequestError({ message: "Unable to refresh MCP credentials", cause: error })),
          )
    const { headers: _configured, ...rest } = config
    const effective = resolved.headers === undefined ? rest : { ...rest, headers: resolved.headers }
    const opened = Effect.gen(function* () {
      const connection = yield* McpClient.connect(name, effective, provider).pipe(Scope.provide(scope))
      const tools = yield* connection.tools()
      return { connection, tools }
    })
    const { connection, tools } = yield* opened.pipe(
      Effect.mapError((error): McpClient.RequestError | McpClient.NeedsAuthError | McpHeaders.ValuesError =>
        kind === "values" && (error._tag === "Mcp.NeedsAuthError" || McpClient.isForbidden(error.cause))
          ? new McpHeaders.ValuesError({ message: McpHeaders.rejected })
          : error,
      ),
    )
    return {
      descriptor,
      scope,
      connection,
      tools,
      ...(integrationID === undefined ? {} : { integrationID }),
    } satisfies Entry
  }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
})

/**
 * Status text for a failed connection. Discovery reports a values server's
 * missing values as NeedsAuthError and the server's refusal as ValuesError.
 */
const failureMessage = (error: McpClient.RequestError | McpClient.NeedsAuthError | McpHeaders.ValuesError) => {
  if (error._tag === "Mcp.ValuesError") return error.message
  if (error._tag === "Mcp.NeedsAuthError") return "Authentication required"
  return "Connection failed"
}
