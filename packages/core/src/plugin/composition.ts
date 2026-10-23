export * as PluginComposition from "./composition.js"

import { Integration } from "@bymorning/schema/integration"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { Catalog } from "../catalog.js"
import { PluginInternal } from "./internal.js"

/** Built-in definitions resolved against the current Workspace catalog. */
export const definitions = PluginInternal.list(
  Catalog.Service.use((catalog) => Effect.all({ all: catalog.model.all(), available: catalog.model.available() })),
)

/** Availability changes which require regenerating catalog-backed built-ins. */
export const changes = Stream.unwrap(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const catalog = yield* Catalog.Service
    return (yield* bus.subscribe([Integration.Event.Updated, Integration.Event.ConnectionUpdated]))
      .pipe(Stream.mapEffect(() => catalog.reload()))
  }),
)
