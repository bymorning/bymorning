export * as Reference from "./reference.js"

import type { ReferenceEditor } from "@bymorning/plugin/effect/reference"
import { Event, Info, type GitSource, type Source } from "@bymorning/schema/reference"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Context, Effect, Layer, Scope, Types } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { AppProcess } from "./util/process.js"
import { makeWorkspaceNode, tags, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

interface Data {
  readonly sources: Map<string, Types.DeepMutable<Source>>
}

export interface Interface extends State.Transformable<ReferenceEditor> {
  // @effect-diagnostics-next-line lazyEffect:off
  readonly list: () => Effect.Effect<Info[]>
}

/** Replayable local and Git reference materialization authority. */
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Reference") {}

export const layer = (cacheDirectory: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const processes = yield* AppProcess.Service
      const scope = yield* Scope.Scope
      const list = (): Info[] =>
        Array.from(state.get().sources.entries()).map(([name, source]) => {
          const referencePath =
            source.type === "local"
              ? source.path
              : AbsolutePath.make(path.join(cacheDirectory, encode(`${source.repository}\0${source.branch ?? ""}`)))
          return Info.make({
            name,
            path: referencePath,
            ...(source.description === undefined ? {} : { description: source.description }),
            ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
            source,
          })
        })
      const state = State.create<Data, ReferenceEditor>({
        name: "reference",
        initial: () => ({ sources: new Map() }),
        editor: (data) => ({
          add: (name, source) => data.sources.set(name, structuredClone(source)),
          remove: (name) => {
            data.sources.delete(name)
          },
          list: () => Array.from(data.sources.entries()),
          get: (name) => data.sources.get(name),
        }),
        notify: () =>
          Effect.gen(function* () {
            for (const reference of list()) {
              if (reference.source.type !== "git") continue
              const source = reference.source
              yield* materialize(processes, reference.path, source).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to materialize reference", {
                    name: reference.name,
                    repository: source.repository,
                    cause,
                  }),
                ),
                Effect.forkIn(scope),
              )
            }
            yield* bus.publish(Event.Updated, {}).pipe(Effect.orDie)
          }),
      })
      return Service.of({
        transform: state.transform,
        reload: state.reload,
        list: Effect.fn("Reference.list")(() => Effect.sync(list)),
      })
    }),
  )

/** Build Reference with the host-selected Git cache directory. */
export const configured = (cacheDirectory: string) =>
  makeWorkspaceNode({ service: Service, layer: layer(cacheDirectory), deps: [Bus.node, AppProcess.node] })

/** Host-bound Reference declaration; bind it once with `configured(cacheDirectory)`. */
export const node = LayerNode.unbound<
  Service,
  Interface,
  typeof tags.values.workspace,
  LayerNode.Error<ReturnType<typeof configured>>
>(Service, tags.values.workspace)

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly cacheDirectory: string
  readonly bus: WorkspaceNode<Bus.Service, E>
}) => makeWorkspaceNode({ service: Service, layer: layer(input.cacheDirectory), deps: [input.bus, AppProcess.node] })

const materialize = Effect.fn("Reference.materialize")(function* (
  processes: AppProcess.Interface,
  directory: string,
  source: GitSource,
) {
  yield* Effect.promise(() => mkdir(path.dirname(directory), { recursive: true }))
  const exists = yield* Effect.promise(() =>
    stat(path.join(directory, ".git")).then(
      () => true,
      () => false,
    ),
  )
  if (exists) {
    yield* processes.run(ChildProcess.make("git", ["-C", directory, "pull", "--ff-only"], { stdin: "ignore" }))
    return
  }
  yield* processes.run(
    ChildProcess.make(
      "git",
      ["clone", "--depth", "1", ...(source.branch ? ["--branch", source.branch] : []), source.repository, directory],
      { stdin: "ignore" },
    ),
  )
})

function encode(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
