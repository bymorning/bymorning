import { Catalog as CoreCatalog } from "@bymorning/core/catalog"
import { Model } from "@bymorning/core/model"
import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Provider } from "@bymorning/schema/provider"
import { Context, Effect, Layer, Option } from "effect"
import { NotFoundError } from "./failure.js"

interface Endpoint {
  readonly id: string
  readonly protocol: LLMGateway.Protocol
  readonly model: ModelSchema.Ref
}

export interface Resolved {
  readonly entry: LLMGateway.Entry
  readonly endpoint: Endpoint
  readonly execution: CoreCatalog.Execution
}

export interface Interface {
  readonly list: (protocol: LLMGateway.Protocol) => Effect.Effect<ReadonlyArray<LLMGateway.Entry>>
  readonly resolve: (model: string, protocol: LLMGateway.Protocol) => Effect.Effect<Resolved, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/LLMGateway/Catalog") {}

const protocolFor = (format: Provider.Format): LLMGateway.Protocol | undefined => {
  if (format === "oa-compat") return "openai-chat"
  if (format === "openai") return "openai-responses"
  if (format === "anthropic") return "anthropic-messages"
  if (format === "google") return "google-generate"
}

const supports = (execution: CoreCatalog.Execution, protocol: LLMGateway.Protocol) =>
  execution.routing.type === "aws-bedrock" || protocolFor(execution.selection.format) === protocol

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* CoreCatalog.Service
    return Service.of({
      list: Effect.fn("LLMGateway.Catalog.list")(function* (protocol) {
        const entries: LLMGateway.Entry[] = []
        for (const info of yield* catalog.model.all()) {
          const ref = { provider: info.provider, id: info.id } as ModelSchema.Ref
          const execution = yield* Effect.option(catalog.model.requireExecution(ref))
          if (Option.isSome(execution) && supports(execution.value, protocol))
            entries.push({ id: Model.publicID(info), name: info.name })
        }
        return entries
      }),
      resolve: Effect.fn("LLMGateway.Catalog.resolve")(function* (publicID, protocol) {
        const slash = publicID.indexOf("/")
        const infos = yield* catalog.model.all()
        const info =
          slash > 0
            ? infos.find(
                (candidate) =>
                  candidate.provider === publicID.slice(0, slash) && candidate.id === publicID.slice(slash + 1),
              )
            : infos.find((candidate) => Model.publicID(candidate) === publicID)
        if (info === undefined) return yield* new NotFoundError({ model: publicID })
        const model = { provider: info.provider, id: info.id } as ModelSchema.Ref
        const execution = yield* catalog.model
          .requireExecution(model)
          .pipe(Effect.mapError(() => new NotFoundError({ model: publicID })))
        if (!supports(execution, protocol)) return yield* new NotFoundError({ model: publicID })
        return {
          entry: { id: publicID, name: info.name },
          endpoint: { id: `${info.provider}/${info.id}`, protocol, model },
          execution,
        }
      }),
    })
  }),
)

export * as Catalog from "./catalog.js"
