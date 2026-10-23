import { describe, expect, it } from "@effect/vitest"
import { models as bedrockCandidates } from "@bymorning/models/generated/amazon-bedrock"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Provider } from "@bymorning/schema/provider"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Effect, Layer, Ref, Stream } from "effect"
import { Bus } from "../src/bus.js"
import { Config } from "../src/config.js"
import { Integration } from "../src/integration.js"
import { Model } from "../src/model.js"
import { govCloudProfiles } from "../src/model/direct.js"
import { Catalog } from "../src/catalog.js"
import { Provider as ProviderService } from "../src/provider.js"
import { ModelPolicy } from "../src/model-policy.js"
import { registry } from "../src/provider/registry.js"

describe("ModelPolicy", () => {
  it.effect("reconciles connected providers and preserves seen policy", () => {
    const integrations = registry.map((definition) =>
      integration(
        definition.info.name,
        definition.info.name === Provider.Anthropic || definition.info.name === Provider.AmazonBedrock,
      ),
    )
    const policy = Ref.makeUnsafe({
      disabled: [] as Array<{ provider: Provider.Name; id: string }>,
      seen: [] as Array<{ provider: Provider.Name; id: string }>,
      initialized: [] as Provider.Name[],
    })
    const reconciledModels = Ref.makeUnsafe<ReadonlyArray<ModelSchema.Info>>([])

    return Effect.gen(function* () {
      const config = Config.Service.of({
        provider: { update: () => Effect.die("unused") },
        get: Ref.get(policy).pipe(Effect.map((model_policy) => ({ model_policy }))),
        modelPolicy: {
          reconcile: (provider: Provider.Name, models: ReadonlyArray<ModelSchema.Info>) =>
            Effect.gen(function* () {
              yield* Ref.update(reconciledModels, (current) => [...current, ...models])
              yield* Ref.update(policy, (current) => {
                const seen = new Map(current.seen.map((model) => [`${model.provider}\0${model.id}`, model]))
                const disabled = new Map(current.disabled.map((model) => [`${model.provider}\0${model.id}`, model]))
                for (const model of models) {
                  const key = `${model.provider}\0${model.id}`
                  if (seen.has(key)) continue
                  const identity = { provider: model.provider, id: model.id }
                  seen.set(key, identity)
                  if (model.status === "deprecated") disabled.set(key, identity)
                }
                return { ...current, disabled: [...disabled.values()], seen: [...seen.values()] }
              })
              return { model_policy: yield* Ref.get(policy) }
            }),
          toggle: () => Effect.die("unused"),
          setDefault: () => Effect.die("unused"),
        },
        update: () => Effect.die("unused"),
        refresh: Effect.die("unused"),
        entries: () => Effect.die("unused"),
        changes: () => Stream.empty,
      } as unknown as Config.Interface)
      const bus = Bus.Service.of({
        subscribe: (() => Effect.succeed(Stream.empty)) as Bus.Subscribe,
      } as unknown as Bus.Interface)
      const integrationService = Integration.Service.of({
        list: () => Effect.succeed([integration("context7", true), ...integrations]),
        get: (id: Integration.ID) => Effect.succeed(integrations.find((entry) => entry.id === id)),
      } as unknown as Integration.Interface)
      yield* Effect.gen(function* () {
        const modelPolicy = yield* ModelPolicy.Service

        yield* modelPolicy.flush

        const firstConnection = yield* Ref.get(policy)
        const reconciled = yield* Ref.get(reconciledModels)
        const anthropic = reconciled.filter(({ provider }) => provider === Provider.Anthropic)
        expect(
          reconciled
            .filter(({ provider }) => provider === Provider.AmazonBedrock)
            .map(({ provider, id }) => `${provider}/${id}`)
            .sort(),
        ).toEqual(
          bedrockCandidates
            .filter(({ lifecycle }) => lifecycle !== "deprecated")
            .flatMap(({ local }) => [
              `${local.provider}/${local.id}`,
              // GovCloud row for each documented GovCloud geography profile.
              ...(govCloudProfiles.some((apiID) => apiID === local.id)
                ? [`${local.provider}/us-gov.${local.id.slice("us.".length)}`]
                : []),
            ])
            .sort(),
        )
        expect(firstConnection.seen).toEqual(reconciled.map(({ provider, id }) => ({ provider, id })))
        expect(firstConnection.disabled).toEqual(
          reconciled.filter((model) => model.status === "deprecated").map(({ provider, id }) => ({ provider, id })),
        )

        const preserved = { provider: Provider.Anthropic, id: "claude-sonnet-5" }
        yield* Ref.update(policy, (current) => ({ ...current, disabled: [...current.disabled, preserved] }))
        yield* config.modelPolicy.reconcile(Provider.Anthropic, anthropic)
        expect((yield* Ref.get(policy)).disabled).toEqual([...firstConnection.disabled, preserved])
      }).pipe(
        Effect.provide(
          ModelPolicy.layer(Effect.void).pipe(
            Layer.provide(Catalog.layer),
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Bus.Service, bus),
                Layer.succeed(Config.Service, config),
                Layer.succeed(Integration.Service, integrationService),
                Model.layer,
                ProviderService.layer,
              ),
            ),
          ),
        ),
      )
    })
  })
})

function integration(id: string, connected: boolean): Integration.Info {
  // Bedrock activates only on a regional connection; every other provider on any connection.
  const connection: Integration.Info["connections"][number] =
    id === Provider.AmazonBedrock
      ? ({ type: "regional-env", authKind: "sigv4", region: AwsRegion.make("us-west-2") } as const)
      : ({ type: "env", name: "test" } as const)
  return {
    id: Integration.ID.make(id),
    name: id,
    methods: [],
    connections: connected ? [connection] : [],
  }
}
