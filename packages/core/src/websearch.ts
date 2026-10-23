export * as WebSearch from "./websearch.js"

import type { Editor, Provider } from "@bymorning/plugin/effect/websearch"
import { Event, ID, Response, Result, type Input } from "@bymorning/schema/websearch"
import type { Provider as WebSearchProvider } from "@bymorning/schema/websearch"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Bus } from "./bus.js"
import type { WorkspaceConfig } from "./config.js"
import { State } from "./state.js"

export class ProviderRequiredError extends Schema.TaggedError<ProviderRequiredError>()(
  "WebSearch.ProviderRequired",
  {},
) {}

export class ProviderNotFoundError extends Schema.TaggedError<ProviderNotFoundError>()("WebSearch.ProviderNotFound", {
  providerID: ID,
}) {}

export class DisabledError extends Schema.TaggedError<DisabledError>()("WebSearch.Disabled", {}) {}

export class RequestError extends Schema.TaggedError<RequestError>()("WebSearch.Request", {
  providerID: ID,
  cause: Schema.Defect(),
}) {}

export type Error = ProviderRequiredError | ProviderNotFoundError | DisabledError | RequestError

export interface Interface extends State.Transformable<Editor> {
  // @effect-diagnostics-next-line lazyEffect:off
  readonly providers: () => Effect.Effect<readonly WebSearchProvider[]>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly default: () => Effect.Effect<WebSearchProvider | undefined, DisabledError>
  readonly query: (input: Input) => Effect.Effect<Response, Error>
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/WebSearch") {}

interface Data {
  readonly providers: Map<string, Provider>
  selection: string | false
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const decodeResults = Schema.decodeUnknownEffect(Schema.Array(Result))
    const state = State.create<Data, Editor>({
      name: "websearch",
      initial: () => ({ providers: new Map(), selection: "random" }),
      editor: (data) => ({
        add: (provider) => data.providers.set(provider.id, provider),
        default: {
          get: () => data.selection,
          set: (selection) => {
            data.selection = selection
          },
        },
      }),
      notify: () => bus.publish(Event.Updated, {}).pipe(Effect.orDie, Effect.asVoid),
    })

    const defaultProvider = Effect.fn("WebSearch.default")(function* () {
      const data = state.get()
      const selection = data.selection
      if (selection === false) return yield* new DisabledError()
      if (selection === "random") {
        const providers = Array.from(data.providers.values())
        const provider = providers[Math.floor(Math.random() * providers.length)]
        return provider && { id: ID.make(provider.id), name: provider.name }
      }
      const provider = data.providers.get(selection)
      return provider && { id: ID.make(provider.id), name: provider.name }
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      providers: Effect.fn("WebSearch.providers")(function* () {
        return Array.from(state.get().providers.values(), (provider) => ({
          id: ID.make(provider.id),
          name: provider.name,
        })).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      default: defaultProvider,
      query: Effect.fn("WebSearch.query")(function* (input) {
        const providers = state.get().providers
        const selected = input.providerID ?? (yield* defaultProvider())?.id
        if (!selected) return yield* new ProviderRequiredError()
        const provider = providers.get(selected)
        if (!provider) return yield* new ProviderNotFoundError({ providerID: selected })
        const results = yield* provider.execute({ query: input.query }).pipe(
          Effect.flatMap(decodeResults),
          Effect.mapError((cause) => new RequestError({ providerID: ID.make(provider.id), cause })),
        )
        return new Response({
          providerID: ID.make(provider.id),
          results,
        })
      }),
    })
  }),
)

export const workspaceNodes = <E>(
  bus: WorkspaceNode<Bus.Service, E>,
  _config: WorkspaceNode<WorkspaceConfig.Service, E>,
) => makeWorkspaceNode({ service: Service, layer, deps: [bus] })

export const node = makeWorkspaceNode({ service: Service, layer, deps: [Bus.node] })
