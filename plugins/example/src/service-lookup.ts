import { Plugin, Tool } from "@bymorning/plugin"
import { Schema } from "effect"

const integrationID = "example.service-lookup-api"
const permissionAction = "service.lookup"
const defaultBaseURL = "https://services.example.com"
const requestTimeout = 10_000
const maximumResponseBytes = 64 * 1024

const ServiceName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
)
const Owner = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Runbook = Schema.String.check(Schema.isMaxLength(2_048))
const Service = Schema.Struct({
  service: ServiceName,
  owners: Schema.Array(Owner).check(Schema.isMaxLength(20)),
  runbook: Schema.optionalKey(Runbook),
})

/**
 * Expected API contract: GET {baseURL}/v1/services/{service} accepts a bearer token and returns
 * JSON `{ service: string, owners: string[], runbook?: string }`. Responses are capped at 64 KiB.
 */
const plugin = Plugin.define({
  id: "example.service-lookup",
  configuration: {
    title: "Service lookup",
    description: "Look up service ownership and runbooks through a read-only service catalog API.",
    fields: [
      {
        key: "baseURL",
        type: "string",
        title: "Service catalog API URL",
        description: "Base HTTPS URL for the service catalog REST API.",
        format: "uri",
        required: true,
        default: defaultBaseURL,
      },
    ],
  },
  async setup(context) {
    const baseURL = configuredBaseURL(context.options.baseURL)

    await context.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Service catalog API"
        integration.connectionPolicy = "member-only"
      })
      editor.method.update({ integrationID, method: { type: "key", label: "Service catalog API token" } })
    })

    await context.tool.transform((editor) => {
      editor.namespace({ name: "service", description: "Read-only service ownership and runbook lookup." })
      editor.add({
        name: "lookup",
        description: "Look up the owners and runbook for one service.",
        input: Schema.Struct({ service: ServiceName }),
        output: Service,
        options: { namespace: "service", permission: permissionAction },
        execute: async ({ service }, toolContext) => {
          await toolContext.permission({ action: permissionAction, resources: [`service:${service}`] })

          const connection = await context.integration.connection.active(integrationID)
          if (connection === undefined) throw toolError("A Service catalog API connection is required")
          const credential = await context.integration.connection.resolve(connection)
          if (credential?.type !== "key" || credential.key === "")
            throw toolError("A Service catalog API token is required")

          const endpoint = new URL(`/v1/services/${encodeURIComponent(service)}`, baseURL)
          let response: Response
          try {
            response = await fetch(endpoint, {
              headers: { Authorization: `Bearer ${credential.key}`, Accept: "application/json" },
              redirect: "error",
              signal: AbortSignal.timeout(requestTimeout),
            })
          } catch {
            throw toolError("Service catalog request failed")
          }
          if (!response.ok) {
            await discard(response.body)
            throw toolError(`Service catalog request failed (${response.status})`)
          }

          let value: unknown
          try {
            value = JSON.parse(await readBounded(response, maximumResponseBytes))
          } catch {
            throw toolError("Service catalog returned an invalid response")
          }
          try {
            return { output: Schema.decodeUnknownSync(Service)(value) }
          } catch {
            throw toolError("Service catalog returned an invalid response")
          }
        },
      })
    })
  },
})

function configuredBaseURL(value: unknown) {
  if (value === undefined) return defaultBaseURL
  if (typeof value !== "string") throw new Error("Invalid Service lookup configuration")
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    )
      throw new Error("Invalid URL")
    return url.href
  } catch {
    throw new Error("Invalid Service lookup configuration")
  }
}

async function readBounded(response: Response, maximumBytes: number) {
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await discard(response.body)
    throw new Error("Response too large")
  }
  if (response.body === null) throw new Error("Response has no body")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw new Error("Response too large")
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concat(chunks, size))
}

async function discard(body: ReadableStream<Uint8Array> | null) {
  try {
    await body?.cancel()
  } catch {
    // The response is already being converted to a sanitized Tool.Error.
  }
}

function concat(chunks: readonly Uint8Array[], size: number) {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function toolError(message: string) {
  return new Tool.Error({ message })
}

export default plugin
