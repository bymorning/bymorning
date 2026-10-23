import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Exposes the Config capability owned by this module. */
export * as Config from "./config.js"
export * as WorkspaceConfig from "./config.js"

import { Config } from "@bymorning/schema/config"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { ConfigPlugin } from "@bymorning/schema/config/plugin"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import type { Form } from "@bymorning/schema/form"
import type { Plugin } from "@bymorning/schema/plugin"
import { Workspace } from "@bymorning/schema/workspace"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, MutableRef, Option, Schema, Scope, Stream, SynchronizedRef } from "effect"
import { Database } from "./database.js"
import { ConfigTable } from "./database/schema/config.sql.js"
import { Bus } from "./bus.js"
import { Installation } from "./installation.js"
import { applyLock } from "./config/lock.js"
import { configurationTarget, resolveConfigurationTarget } from "./plugin/source-target.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "./actor.js"

export class StorageError extends Schema.TaggedError<StorageError>()("Config.StorageError", {
  operation: Schema.Literals(["provider.update", "mcp.update", "model.put", "model.remove"]),
  message: Schema.String,
}) {}

/**
 * Workspace Config sections that decide where member data flows or what code runs:
 * risky Provider admission, model rewrites, Plugin installation, execution and
 * egress selection, and Workspace-wide activity caps. Members may read the whole
 * document but never change these (NIST 3.1.5 least privilege, 3.1.7 privileged
 * functions). `compaction` stays member-writable; `default_model`,
 * `model_policy`, and custom `models` are server-owned and stripped from the
 * payload by Config.update.
 */
const adminSections = [
  ["Plugin configuration", (info: Config.Info) => info.plugins ?? null],
  ["Provider admission", (info: Config.Info) => info.providers?.allow ?? null],
  ["Routing", (info: Config.Info) => info.routing ?? null],
  ["Gateway configuration", (info: Config.Info) => info.gateway ?? null],
  ["Web search selection", (info: Config.Info) => info.websearch ?? null],
  ["Code Interpreter selection", (info: Config.Info) => info.code_interpreter ?? null],
  ["Tool output limits", (info: Config.Info) => info.tool_output ?? null],
  ["default Agent", (info: Config.Info) => info.default_agent ?? null],
] satisfies ReadonlyArray<readonly [section: string, select: (info: Config.Info) => unknown]>

/** Refuse a non-administrator's mutation of an admin-only Config section, evaluated against the transaction's own current document. */
const guardSections = (
  actor: Actor.Info,
  current: Config.Info,
  next: Config.Info,
  resolve: (info: Config.Info) => Config.Info,
) =>
  Effect.gen(function* () {
    if (actor.type === "system" || actor.type === "workspace") return
    const privileged = actor.type === "user" && actor.properties.role === "admin"
    const forbidden = (section: string) =>
      new Actor.ForbiddenError({ message: `Only Workspace administrators can change ${section}` })
    if (JSON.stringify(current.permissions) !== JSON.stringify(next.permissions) && !privileged)
      return yield* forbidden("permissions")
    if (
      JSON.stringify(current.providers?.activation ?? null) !== JSON.stringify(next.providers?.activation ?? null) &&
      !privileged
    )
      return yield* forbidden("Provider activation")
    if (
      JSON.stringify({
        activation: current.mcp?.activation ?? null,
        servers: current.mcp?.servers ?? null,
      }) !==
        JSON.stringify({
          activation: next.mcp?.activation ?? null,
          servers: next.mcp?.servers ?? null,
        }) &&
      !privileged
    )
      return yield* forbidden("MCP activation")
    if (privileged) return
    const resolvedCurrent = resolve(current)
    const resolvedNext = resolve(next)
    for (const [section, select] of adminSections) {
      if (JSON.stringify(select(resolvedCurrent)) !== JSON.stringify(select(resolvedNext))) return yield* forbidden(section)
    }
  })

/** Workspace-bound runtime Config authority. */
export interface Interface {
  /** Read the active, fully resolved in-memory Config. */
  readonly get: Effect.Effect<Config.Info>
  /**
   * Replace client-owned Config fields while preserving server-owned model policy and default.
   * Admin-only sections refuse a caller without the admin Role (Actor.ForbiddenError);
   * the edge supplies the Actor it authorized.
   */
  readonly update: (input: Config.Stored, actor: Actor.Info) => Effect.Effect<Config.Info, Actor.ForbiddenError>
  /** Reload and resolve the stored Config into the active Config. */
  readonly refresh: Effect.Effect<Config.Info>
  readonly provider: {
    readonly update: (input: Provider.UpdateInput, actor: Actor.Info) => Effect.Effect<Config.Info, StorageError | Actor.ForbiddenError>
  }
  readonly modelPolicy: {
    readonly reconcile: (provider: Provider.Name, models: ReadonlyArray<Model.Info>) => Effect.Effect<Config.Info>
    /** @deprecated Internal compatibility surface; reconciliation is identity-based. */
    readonly initialize?: (
      provider: Provider.Name,
      deprecated: ReadonlyArray<Model.Identity>,
    ) => Effect.Effect<Config.Info>
    readonly toggle: (input: Model.ToggleInput, actor: Actor.Info) => Effect.Effect<Config.Info, Actor.ForbiddenError>
    readonly setDefault: (model: Model.Identity, actor: Actor.Info) => Effect.Effect<Config.Info, Actor.ForbiddenError>
  }
  /** Workspace-configured custom Models. Catalog validates them against the effective Catalog. */
  readonly model: {
    /** Insert or replace the custom Model with the same Provider and key. */
    readonly put: (model: Model.Custom, actor: Actor.Info) => Effect.Effect<Config.Info, StorageError | Actor.ForbiddenError>
    /** Remove a custom Model with its enablement state and any default selection of it. */
    readonly remove: (model: Model.Identity, actor: Actor.Info) => Effect.Effect<Config.Info, StorageError | Actor.ForbiddenError>
  }
  readonly mcp: {
    readonly update: (name: string, activation: ConfigMCP.Activation, actor: Actor.Info) => Effect.Effect<Config.Info, StorageError | Actor.ForbiddenError>
    readonly put: (name: string, server: ConfigMCP.Remote, actor: Actor.Info) => Effect.Effect<Config.Info, Actor.ForbiddenError>
    readonly remove: (name: string, actor: Actor.Info) => Effect.Effect<Config.Info, Actor.ForbiddenError>
  }
  readonly plugin: {
    readonly configure: (
      source: Plugin.Source,
      id: Plugin.ID,
      options: Form.Answer,
    ) => Effect.Effect<PluginCompensation>
  }
  /** Present installation declarations followed by the persisted Workspace document. */
  // @effect-diagnostics-next-line lazyEffect:off
  readonly entries: () => Effect.Effect<readonly Config.Entry[]>
  /** Subscribe to committed process-local Config changes. */
  // @effect-diagnostics-next-line lazyEffect:off
  readonly changes: () => Stream.Stream<void>
}

export interface PluginCompensation {
  readonly rollback: Effect.Effect<void>
}

/** Adapter for Config implementations which do not persist plugin configuration. */
export const pluginUnavailable = {
  configure: () => Effect.die(new Error("Plugin configuration persistence is unavailable")),
}

/**
 * Keep one synchronous projection of the active Config current, closing the
 * subscribe race the same way the removed ConfigEntryObserver did. The returned
 * cell is safe to read from synchronous State editors and `ordered`-style selectors.
 */
export const follow = <A>(
  project: (info: Config.Info) => A,
): Effect.Effect<MutableRef.MutableRef<A>, never, Service | Scope.Scope> =>
  Effect.gen(function* () {
    const workspace = yield* Service
    const cell = MutableRef.make<A>(project(yield* workspace.get))
    const update = Effect.map(workspace.get, (info) => MutableRef.set(cell, project(info)))
    yield* workspace.changes().pipe(
      Stream.runForEach(() => update),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Close the race between the first read and establishing the subscription.
    yield* update
    return cell
  })

/** Workspace-bound runtime Config authority. */
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Config") {}

/** PostgreSQL-backed Config implementation with process-local active state. */
export const layer = (workspaceID: Workspace.ID, defaults: readonly Config.Entry[] = []) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const installation = yield* Installation.Service
      const load = Effect.fn("Config.load")(function* () {
        // FOR SHARE waits for an in-flight write to commit, so a refresh never
        // reinstates the row that write is replacing.
        const rows = yield* database.use("Config.load", (db) =>
          db
            .select({ value: ConfigTable.value })
            .from(ConfigTable)
            .where(eq(ConfigTable.workspaceId, workspaceID))
            .limit(1)
            .for("share")
            .pipe(Effect.orDie),
        )
        const row = yield* Effect.fromOption(Option.fromNullishOr(rows[0])).pipe(Effect.orDie)
        return yield* Schema.decodeUnknownEffect(Config.Info)(row.value).pipe(Effect.orDie)
      })
      const active = yield* SynchronizedRef.make(yield* load())
      // Installation declarations are read-only defaults, never copied into persistence.
      const selection = defaults.findLast((entry) => entry.info.code_interpreter !== undefined)?.info.code_interpreter
      const plugins = defaults.flatMap((entry) => entry.info.plugins ?? [])
      const activation = Object.assign({}, ...defaults.map((entry) => entry.info.providers?.activation ?? {}))
      const resolve = (info: Config.Info, policy: Installation.Policy): Config.Info =>
        applyLock(
          {
            ...info,
            ...(info.code_interpreter === undefined && selection !== undefined ? { code_interpreter: selection } : {}),
            ...(plugins.length === 0 ? {} : { plugins: [...plugins, ...(info.plugins ?? [])] }),
            ...(Object.keys(activation).length === 0 && info.providers?.activation === undefined
              ? {}
              : {
                  providers: {
                    ...info.providers,
                    activation: { ...activation, ...info.providers?.activation },
                  },
                }),
          },
          policy,
        )
      /** Resolve with the current Installation Policy lock applied. */
      const locked = (info: Config.Info) => Effect.map(installation.policy.get, (policy) => resolve(info, policy))
      const equivalent = Schema.toEquivalence(Config.Info)
      // Inside an enclosing transaction (for example an audited edge write), observers
      // hear of the change only after it commits, so none of them reloads the previous row.
      const publish = (value: Config.Info) =>
        database.afterCommit(bus.publish(Config.Event.Updated, {}).pipe(Effect.orDie)).pipe(Effect.as(value))
      const persist = (input: Config.Info) =>
        Schema.encodeEffect(Config.Info)(input).pipe(
          Effect.orDie,
          Effect.flatMap((stored) =>
            database.use("Config.patch", (db) =>
              db
                .update(ConfigTable)
                .set({ value: stored, timeUpdated: new Date() })
                .where(eq(ConfigTable.workspaceId, workspaceID))
                .returning({ value: ConfigTable.value })
                .pipe(
                  Effect.orDie,
                  Effect.flatMap((rows) => Effect.fromOption(Option.fromNullishOr(rows[0]))),
                  Effect.flatMap((row) => Schema.decodeUnknownEffect(Config.Info)(row.value)),
                  Effect.orDie,
                ),
            ),
          ),
        )
      const patch = (update: (current: Config.Info) => Config.Info) =>
        SynchronizedRef.modifyEffect(active, () =>
          database
            .transact(
              database
                .use("Config.patch.load", (db) =>
                  db
                    .select({ value: ConfigTable.value })
                    .from(ConfigTable)
                    .where(eq(ConfigTable.workspaceId, workspaceID))
                    .limit(1)
                    .for("update")
                    .pipe(Effect.orDie),
                )
                .pipe(
                  Effect.flatMap((rows) => Effect.fromOption(Option.fromNullishOr(rows[0]))),
                  Effect.flatMap((row) => Schema.decodeUnknownEffect(Config.Info)(row.value)),
                  Effect.flatMap((current) => {
                    const updated = update(current)
                    if (equivalent(current, updated)) return Effect.succeed({ value: current, changed: false })
                    return persist(updated).pipe(Effect.map((value) => ({ value, changed: true })))
                  }),
                  Effect.orDie,
                ),
            )
            .pipe(
              Effect.orDie,
              Effect.map((result) => [result, result.value] as const),
            ),
        ).pipe(Effect.flatMap(({ value, changed }) => (changed ? publish(value) : Effect.succeed(value))))
      return Service.of({
        get: SynchronizedRef.get(active).pipe(Effect.flatMap(locked), Effect.withSpan("Config.get")),
        update: Effect.fn("Config.update")(function* (input: Config.Stored, actor: Actor.Info) {
          return yield* SynchronizedRef.modifyEffect(active, () =>
            database
              .transact(
                database
                  .use("Config.update.lock", (db) =>
                    db
                      .select({ value: ConfigTable.value })
                      .from(ConfigTable)
                      .where(eq(ConfigTable.workspaceId, workspaceID))
                      .limit(1)
                      .for("update")
                      .pipe(Effect.orDie),
                  )
                  .pipe(
                    Effect.flatMap((rows) => Effect.fromOption(Option.fromNullishOr(rows[0]))),
                    Effect.flatMap((row) => Schema.decodeUnknownEffect(Config.Info)(row.value)),
                    Effect.flatMap((current) =>
                      Schema.decodeUnknownEffect(Config.Info)(input).pipe(
                        Effect.map((value) => {
                          const { default_model: _, model_policy: __, models: ___, ...clientOwned } = value
                          return [
                            current,
                            {
                              ...clientOwned,
                              ...(current.default_model === undefined ? {} : { default_model: current.default_model }),
                              ...(current.models === undefined ? {} : { models: current.models }),
                              model_policy: current.model_policy,
                            },
                          ] as const
                        }),
                      ),
                    ),
                    // The admin-section rule evaluates against the very row this
                    // transaction replaces, so a concurrent write cannot smuggle a
                    // section change past a check computed from a stale read.
                    Effect.tap(([current, next]) =>
                      Effect.flatMap(installation.policy.get, (policy) =>
                        guardSections(actor, current, next, (info) => resolve(info, policy)),
                      ),
                    ),
                    Effect.flatMap(([_, next]) => persist(next)),
                    Effect.catch((error) =>
                      error instanceof Actor.ForbiddenError ? Effect.fail(error) : Effect.die(error),
                    ),
                  ),
              )
              .pipe(
                Effect.catch((error) =>
                  error instanceof Actor.ForbiddenError ? Effect.fail(error) : Effect.die(error),
                ),
                Effect.map((value) => [value, value] as const),
              ),
          ).pipe(Effect.flatMap(publish), Effect.flatMap(locked))
        }),
        refresh: SynchronizedRef.modifyEffect(active, (previous) =>
          load().pipe(
            Effect.map(
              (value) => [{ value, changed: JSON.stringify(previous) !== JSON.stringify(value) }, value] as const,
            ),
          ),
        ).pipe(
          Effect.flatMap(({ value, changed }) => (changed ? publish(value) : Effect.succeed(value))),
          Effect.flatMap(locked),
          Effect.withSpan("Config.refresh"),
        ),
        provider: {
          update: Effect.fn("Config.provider.update")((input, actor: Actor.Info) =>
            // Provider Activation is a Workspace administrator decision.
            Actor.requireAdmin(actor, "Only Workspace administrators can change Provider activation").pipe(
              Effect.andThen(
                patch((current) => ({
                  ...current,
                  providers: {
                    ...current.providers,
                    activation: { ...current.providers?.activation, [input.provider]: input.status },
                  },
                })).pipe(
                  Effect.catchCause((cause) =>
                    new StorageError({ operation: "provider.update", message: String(cause) }),
                  ),
                  Effect.flatMap(locked),
                ),
              ),
            ),
          ),
        },
        modelPolicy: {
          reconcile: Effect.fn("Config.modelPolicy.reconcile")((provider, models) =>
            patch((current) => {
              const policy = current.model_policy
              const seen = new Map(policy.seen.map((model) => [`${model.provider}\0${model.id}`, model]))
              const disabled = new Map(policy.disabled.map((model) => [`${model.provider}\0${model.id}`, model]))
              if (policy.initialized.includes(provider) && !policy.seen.some((model) => model.provider === provider)) {
                for (const model of legacySeenBaseline.get(provider) ?? [])
                  seen.set(`${model.provider}\0${model.id}`, model)
              }
              for (const model of models) {
                const identity = { provider: model.provider, id: model.id }
                const key = `${model.provider}\0${model.id}`
                if (seen.has(key)) continue
                seen.set(key, identity)
                if (model.status === "deprecated") disabled.set(key, identity)
              }
              return {
                ...current,
                model_policy: {
                  disabled: [...disabled.values()],
                  seen: [...seen.values()],
                  initialized: policy.initialized,
                },
              }
            }),
          ),
          toggle: Effect.fn("Config.modelPolicy.toggle")((input, actor: Actor.Info) =>
            // Shared Model enablement is a Workspace admission decision.
            Actor.requireAdmin(actor, "Only Workspace administrators can change Model enablement").pipe(
              Effect.andThen(
                patch((current) => {
                  const identity = { provider: input.provider, id: input.id }
                  const seen = new Map(current.model_policy.seen.map((model) => [`${model.provider}\0${model.id}`, model]))
                  const disabled = new Map(
                    current.model_policy.disabled.map((model) => [`${model.provider}\0${model.id}`, model]),
                  )
                  const key = `${input.provider}\0${input.id}`
                  seen.set(key, identity)
                  if (input.enabled) disabled.delete(key)
                  if (!input.enabled) disabled.set(key, identity)
                  return {
                    ...current,
                    model_policy: {
                      ...current.model_policy,
                      disabled: [...disabled.values()],
                      seen: [...seen.values()],
                    },
                  }
                }),
              ),
            ),
          ),
          setDefault: Effect.fn("Config.modelPolicy.setDefault")((model, actor: Actor.Info) =>
            Actor.requireAdmin(actor, "Only Workspace administrators can change the default Model").pipe(
              Effect.andThen(
                patch((current) => {
                  const seen = new Map(
                    current.model_policy.seen.map((identity) => [`${identity.provider}\0${identity.id}`, identity]),
                  )
                  seen.set(`${model.provider}\0${model.id}`, { ...model })
                  return {
                    ...current,
                    default_model: { ...model },
                    model_policy: { ...current.model_policy, seen: [...seen.values()] },
                  }
                }),
              ),
            ),
          ),
        },
        model: {
          put: Effect.fn("Config.model.put")((model, actor: Actor.Info) =>
            Actor.requireAdmin(actor, "Only Workspace administrators can configure custom Models").pipe(
              Effect.andThen(
                patch((current) => {
                  const models = [...(current.models ?? [])]
                  const index = models.findIndex((entry) => entry.provider === model.provider && entry.id === model.id)
                  if (index < 0) models.push({ ...model })
                  else models[index] = { ...model }
                  return { ...current, models }
                }).pipe(
                  Effect.catchCause((cause) => new StorageError({ operation: "model.put", message: String(cause) })),
                  Effect.flatMap(locked),
                ),
              ),
            ),
          ),
          remove: Effect.fn("Config.model.remove")((model, actor: Actor.Info) =>
            Actor.requireAdmin(actor, "Only Workspace administrators can configure custom Models").pipe(
              Effect.andThen(
                patch((current) => {
                  const same = (entry: Model.Identity) => entry.provider === model.provider && entry.id === model.id
                  if (!(current.models ?? []).some(same)) return current
                  const { default_model, ...rest } = current
                  return {
                    ...rest,
                    ...(default_model === undefined || same(default_model) ? {} : { default_model }),
                    models: (current.models ?? []).filter((entry) => !same(entry)),
                    model_policy: {
                      ...current.model_policy,
                      disabled: current.model_policy.disabled.filter((entry) => !same(entry)),
                      seen: current.model_policy.seen.filter((entry) => !same(entry)),
                    },
                  }
                }).pipe(
                  Effect.catchCause((cause) => new StorageError({ operation: "model.remove", message: String(cause) })),
                  Effect.flatMap(locked),
                ),
              ),
            ),
          ),
        },
        mcp: {
          update: Effect.fn("Config.mcp.update")((name, activation, actor: Actor.Info) =>
            // Outbound MCP Enablement is a Workspace administrator decision.
            Actor.requireAdmin(actor, "Only Workspace administrators can change MCP activation").pipe(
              Effect.andThen(
                patch((current) => ({
                  ...current,
                  mcp: {
                    ...current.mcp,
                    activation: { ...current.mcp?.activation, [name]: activation },
                  },
                })).pipe(
                  Effect.catchCause((cause) => new StorageError({ operation: "mcp.update", message: String(cause) })),
                  Effect.flatMap(locked),
                ),
              ),
            ),
          ),
          put: Effect.fn("Config.mcp.put")((name, server, actor: Actor.Info) =>
            Actor.requireAdmin(actor, "Only Workspace administrators can register MCP servers").pipe(
              Effect.andThen(
                patch((current) => ({
                  ...current,
                  mcp: {
                    ...current.mcp,
                    servers: { ...current.mcp?.servers, [name]: server },
                  },
                })),
              ),
            ),
          ),
          remove: Effect.fn("Config.mcp.remove")((name, actor: Actor.Info) =>
            Actor.requireAdmin(actor, "Only Workspace administrators can remove MCP servers").pipe(
              Effect.andThen(
                patch((current) => {
                  if (current.mcp?.servers?.[name] === undefined) return current
                  const servers = { ...current.mcp.servers }
                  delete servers[name]
                  return { ...current, mcp: { ...current.mcp, servers } }
                }),
              ),
            ),
          ),
        },
        plugin: {
          configure: Effect.fn("Config.plugin.configure")(function* (source, id, options) {
            const target = configurationTarget(source, id)
            if (target === undefined) return yield* Effect.die(new Error(`Plugin source cannot be configured: ${id}`))
            const previous = MutableRef.make<Config.Info["plugins"]>(undefined)
            const value = yield* patch((current) => {
              MutableRef.set(previous, current.plugins)
              const submitted = [
                ...(current.plugins ?? []).filter((entry) => {
                  const candidate = typeof entry === "string" ? entry : entry.package
                  if (candidate === target) return false
                  if (source.type !== "local") return true
                  return resolveConfigurationTarget(candidate) !== target
                }),
                new ConfigPlugin.Entry({ package: target, options }),
              ]
              return { ...current, plugins: submitted }
            })
            const submitted = value.plugins ?? []
            return {
              rollback: patch((current) => {
                if (!Schema.toEquivalence(ConfigPlugin.Plugins)(current.plugins ?? [], submitted)) return current
                const snapshot = MutableRef.get(previous)
                if (snapshot !== undefined) return { ...current, plugins: snapshot }
                const { plugins: _, ...rest } = current
                return rest
              }).pipe(Effect.asVoid),
            }
          }),
        },
        entries: () =>
          SynchronizedRef.get(active).pipe(
            Effect.map((info) => [...defaults, Config.Document.make({ type: "document", info })]),
          ),
        // Each Config consumer needs its own live Bus subscription. Retaining one
        // PubSub subscription here made adapters compete for updates, so a Config
        // change could be consumed by another adapter before MCP observed it.
        changes: () => Stream.unwrap(bus.subscribe(Config.Event.Updated)).pipe(Stream.map(() => undefined)),
      })
    }),
  )

/** Catalog identities which predate identity-level first-seen policy. */
export const legacySeenBaseline = new Map<Provider.Name, ReadonlyArray<Model.Identity>>([
  [Provider.OpenAI, ["gpt-5.6", "gpt-5.4-mini"].map((id) => ({ provider: Provider.OpenAI, id }))],
  [Provider.Anthropic, ["claude-sonnet-5", "claude-opus-4-1"].map((id) => ({ provider: Provider.Anthropic, id }))],
  [Provider.Fireworks, ["glm-5p2", "kimi-k2p7-code"].map((id) => ({ provider: Provider.Fireworks, id }))],
])

/** Canonical persisted Config node for the verified member's Workspace. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID).pipe(Layer.orDie))),
  deps: [Actor.binding, Bus.node, Database.node, Installation.node],
})

/** Installation plugin declarations and execution selection beneath persisted Workspace overrides. */
export const configured = (defaults: readonly Config.Entry[]) =>
  makeWorkspaceNode({
    service: Service,
    layer: Layer.unwrap(
      Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID, defaults).pipe(Layer.orDie)),
    ),
    deps: [Actor.binding, Bus.node, Database.node, Installation.node],
  })

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  bus: WorkspaceNode<Bus.Service, E>,
  database?: GlobalNode<Database.Service, E>,
) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(workspaceID).pipe(Layer.orDie),
    deps: [bus, database ?? Database.node, Installation.node],
  })

/** Compatibility production layer for tests and non-graph callers. */
export const defaultLayer = (workspaceID: Workspace.ID) =>
  layer(workspaceID).pipe(Layer.provide(Layer.merge(Database.defaultLayer, Installation.defaultLayer)))
