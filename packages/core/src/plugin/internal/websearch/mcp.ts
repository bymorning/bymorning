export * as WebSearchMcp from "./mcp.js"

import { Duration, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const MAX_RESPONSE_BYTES = 256 * 1024

export class ProviderError extends Schema.TaggedError<ProviderError>()("WebSearchMcp.ProviderError", {
  message: Schema.String,
}) {}

export const parseResponse = <F extends Schema.Struct.Fields>(body: string, result: Schema.Struct<F>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ result })))
  const parse = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return Effect.undefined
    return decode(trimmed).pipe(Effect.map((response) => response.result))
  }
  return Effect.gen(function* () {
    const trimmed = body.trim()
    const direct = trimmed ? yield* parse(trimmed) : undefined
    if (direct) return direct
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const data = yield* parse(line.substring(6))
      if (data) return data
    }
  })
}

export const call = <F extends Schema.Struct.Fields, R extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  schema: { readonly input: Schema.Struct<F>; readonly output: Schema.Struct<R> },
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(
        Schema.Struct({
          jsonrpc: Schema.Literal("2.0"),
          id: Schema.Literal(1),
          method: Schema.Literal("tools/call"),
          params: Schema.Struct({ name: Schema.String, arguments: schema.input }),
        }),
      )({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(http).execute(request)
      const contentLength = response.headers["content-length"]
      const parsedSize = contentLength ? Number.parseInt(contentLength, 10) : undefined
      const declaredSize =
        parsedSize !== undefined && Number.isSafeInteger(parsedSize) && parsedSize >= 0 ? parsedSize : undefined
      if (declaredSize !== undefined && declaredSize > MAX_RESPONSE_BYTES)
        return yield* new ProviderError({ message: `${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes` })
      let body = Buffer.allocUnsafe(Math.min(MAX_RESPONSE_BYTES, declaredSize || 64 * 1024))
      let size = 0
      yield* Stream.runForEach(response.stream, (chunk) => {
        if (chunk.byteLength === 0) return Effect.void
        if (size + chunk.byteLength > MAX_RESPONSE_BYTES)
          return Effect.fail(new ProviderError({ message: `${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes` }))
        if (size + chunk.byteLength > body.byteLength) {
          const grown = Buffer.allocUnsafe(
            Math.min(MAX_RESPONSE_BYTES, Math.max(size + chunk.byteLength, body.byteLength * 2)),
          )
          body.copy(grown, 0, 0, size)
          body = grown
        }
        body.set(chunk, size)
        size += chunk.byteLength
        return Effect.void
      })
      return yield* parseResponse(body.subarray(0, size).toString("utf8"), schema.output)
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new ProviderError({ message: `${tool} request timed out` })),
      }),
    )
  })
