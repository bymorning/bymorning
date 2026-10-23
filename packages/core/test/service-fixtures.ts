import { Agent } from "@bymorning/core/agent"
import { Config } from "@bymorning/core/config"
import { Skill } from "@bymorning/core/skill"
import { ConfigSchema } from "@bymorning/schema/config"
import { Effect, Layer, PubSub, Ref, Stream } from "effect"

export const agentService = (
  service: Omit<Agent.Interface, "transform" | "reload" | "delete"> & Partial<Pick<Agent.Interface, "delete">>,
) =>
  Agent.Service.of({
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    delete: () => Effect.die("unused"),
    ...service,
  })

export const skillService = (service: Omit<Skill.Interface, "transform" | "reload">) =>
  Skill.Service.of({
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    ...service,
  })

/** Minimal decoded Workspace Config with only the schema defaults filled in. */
export const minimalConfig = ConfigSchema.Info.make({
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
})

/** Plain-object Workspace Config authority whose value never changes. */
export const configService = (info: ConfigSchema.Info) =>
  Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: Effect.succeed(info),
    update: () => Effect.die(new Error("unused")),
    refresh: Effect.die(new Error("unused")),
    mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    modelPolicy: {
      reconcile: () => Effect.die("unused"),
      toggle: () => Effect.die("unused"),
      setDefault: () => Effect.die("unused"),
    },
    plugin: Config.pluginUnavailable,
    entries: () => Effect.succeed([]),
    changes: () => Stream.never,
  })

/** Workspace Config authority whose committed changes are observed through `changes`. */
export const configFixture = (info: ConfigSchema.Info) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<void>()
    const current = yield* Ref.make(info)
    const service = Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Ref.get(current),
      update: () => Effect.die(new Error("unused")),
      refresh: Effect.die(new Error("unused")),
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.succeed([]),
      changes: () => Stream.fromPubSub(events),
    })
    const publish = (next: ConfigSchema.Info) =>
      Ref.set(current, next).pipe(Effect.andThen(PubSub.publish(events, undefined)))
    return { layer: Layer.succeed(Config.Service, service), publish }
  })
