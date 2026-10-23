export * as Observability from "./observability.js"

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger, References, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpExporter, OtlpSerialization } from "effect/unstable/observability"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import * as Logging from "./logging.js"
import * as Otlp from "./otlp.js"

/** Runtime observability configuration. */
export const Options = Schema.Struct({
  endpoint: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.String),
  client: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  output: Schema.optional(Schema.Union([Schema.Literal("file"), Schema.Literal("stderr")])),
})

/** Runtime observability configuration. */
export type Options = typeof Options.Type

/**
 * Build structured logging plus optional correlated OTLP logs and traces.
 *
 * OTLP initialization failures fall back to local logging so observability never
 * prevents application startup.
 */
export function layer(
  options: Options = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  },
) {
  const app = {
    client: options.client ?? "bymorning",
    version: options.version ?? "unknown",
    channel: options.channel ?? "local",
  }
  const output = options.output ?? "stderr"
  const directory =
    output === "file"
      ? Layer.effectDiscard(
          Effect.promise(() =>
            mkdir(path.dirname(Logging.file(app.channel === "local", app.channel)), { recursive: true }),
          ),
        )
      : Layer.empty
  const local = Logger.layer(Logging.loggers(output, app.channel), {
    mergeWithExisting: false,
  }).pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(directory),
    Layer.orDie,
    Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
  )
  return Layer.unwrap(
    Effect.gen(function* () {
      const logs = Logger.layer([...Logging.loggers(output, app.channel), ...Otlp.loggers(options, app)], {
        mergeWithExisting: false,
      }).pipe(
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(OtlpExporter.layerFlusher),
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(directory),
        Layer.orDie,
        Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
      )
      return Layer.merge(logs, yield* Effect.promise(() => Otlp.tracingLayer(options, app)))
    }),
  ).pipe(Layer.catchCause(() => local))
}
