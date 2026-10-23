import { Layer } from "effect"
import { OtlpLogger } from "effect/unstable/observability"
import { runID } from "./shared.js"

/** OTLP exporter connection options. */
export interface Options {
  readonly endpoint?: string
  readonly headers?: string
}

/** Safe application identity attached to telemetry resources. */
export interface App {
  readonly client: string
  readonly version: string
  readonly channel: string
}

function parseHeaders(value?: string) {
  return value
    ? value.split(",").reduce(
        (acc, entry) => {
          const [key, ...parts] = entry.split("=")
          if (key !== undefined) acc[key] = parts.join("=")
          return acc
        },
        {} as Record<string, string>,
      )
    : undefined
}

function resourceAttributes() {
  const value = process.env.OTEL_RESOURCE_ATTRIBUTES
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

/** Build the OpenTelemetry resource shared by logs and traces. */
export function resource(app: App = { client: "bymorning", version: "unknown", channel: "local" }): {
  serviceName: string
  serviceVersion: string
  attributes: Record<string, string>
} {
  return {
    serviceName: "bymorning",
    serviceVersion: app.version,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": app.channel,
      "bymorning.client": app.client,
      "bymorning.run": runID,
      "service.instance.id": runID,
    },
  }
}

/** Build correlated OTLP log exporters when an endpoint is configured. */
export function loggers(options: Options | undefined, app: App) {
  if (!options?.endpoint) return []
  return [
    OtlpLogger.make({
      url: `${options.endpoint}/v1/logs`,
      resource: resource(app),
      headers: parseHeaders(options.headers),
    }),
  ]
}

/** Build the Effect OpenTelemetry tracing layer when an endpoint is configured. */
export async function tracingLayer(options: Options | undefined, app: App) {
  if (!options?.endpoint) return Layer.empty
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")

  // Effect owns fiber context; external instrumentations need a global bridge to inherit it.
  const manager = new AsyncLocalStorageContextManager()
  manager.enable()
  context.setGlobalContextManager(manager)

  return NodeSdk.layer(() => ({
    resource: resource(app),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${options.endpoint}/v1/traces`,
        headers: parseHeaders(options.headers),
      }),
    ),
  }))
}
