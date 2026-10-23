import { describe, expect, it } from "@effect/vitest"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Exit, Ref, Scope } from "effect"
import { AISDK } from "../src/aisdk.js"

const model = (provider: string) =>
  Model.Info.make({
    id: "model",
    provider: Provider.Name.make(provider),
    apiID: "model",
    name: "Model",
    description: "",
    status: "active",
    releaseDate: "2026-01-01",
    lastUpdated: "2026-01-01",
    openWeights: false,
    capabilities: { temperature: true, reasoning: false, attachment: false, tools: true, input: [], output: [] },
    variants: [],
    limit: { context: 1, output: 1 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  })

describe("AISDK", () => {
  it.effect("runs matching hooks in registration order and disposes them with scope", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls = yield* Ref.make<string[]>([])
      const scope = yield* Scope.make()
      yield* aisdk
        .hook("sdk", () => Ref.update(calls, (items) => [...items, "all"]))
        .pipe(Scope.provide(scope))
      yield* aisdk
        .hook("sdk", () => Ref.update(calls, (items) => [...items, "matching"]), { providerID: "provider-a" })
        .pipe(Scope.provide(scope))
      yield* aisdk
        .hook("sdk", () => Ref.update(calls, (items) => [...items, "other"]), { providerID: "provider-b" })
        .pipe(Scope.provide(scope))

      yield* aisdk.run("sdk", { model: model("provider-a"), package: "test", options: {} })
      expect(yield* Ref.get(calls)).toEqual(["all", "matching"])

      yield* Scope.close(scope, Exit.void)
      yield* aisdk.run("sdk", { model: model("provider-a"), package: "test", options: {} })
      expect(yield* Ref.get(calls)).toEqual(["all", "matching"])
    }).pipe(Effect.provide(AISDK.layer)),
  )
})
