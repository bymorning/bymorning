import { Observability } from "@bymorning/observability"
import { Config, Effect, Layer, Option } from "effect"

/**
 * Launch telemetry provided above `runMain` (wrapping migration and serve) rather than as a
 * Workspace graph node, so it produces no service.
 */
export const serverObservability = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* Config.all({
      endpoint: Config.option(Config.string("OTEL_EXPORTER_OTLP_ENDPOINT")),
      headers: Config.option(Config.string("OTEL_EXPORTER_OTLP_HEADERS")),
      version: Config.option(Config.string("BYMORNING_VERSION")),
      channel: Config.string("BYMORNING_CHANNEL").pipe(Config.withDefault("local")),
    })
    return Observability.layer({
      endpoint: Option.getOrUndefined(env.endpoint),
      headers: Option.getOrUndefined(env.headers),
      client: "gateway",
      version: Option.getOrUndefined(env.version),
      channel: env.channel,
      output: "stderr",
    })
  }),
)
