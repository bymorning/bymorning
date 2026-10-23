import { Tool } from "../../../tool.js"
import { Duration, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { NodeHttpClient } from "@effect/platform-node"
import { Parser } from "htmlparser2"
import { define } from "@bymorning/plugin/effect/plugin"
import { convertHTMLToMarkdown, MAX_MARKDOWN_BYTES } from "./html-markdown.js"
import { collectBoundedResponseBody } from "./http-body.js"
import { makeNodeLookup, resolvePublic } from "./web-fetch-egress.js"

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = MAX_MARKDOWN_BYTES
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120
/** Redirect hops followed manually so each destination is screened before connecting. */
export const MAX_REDIRECTS = 5

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`

const Timeout = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("markdown" as const))),
  timeout: Schema.optionalKey(Timeout).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

export const Output = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Input.fields.format,
  output: Schema.String,
})
type Format = (typeof Input.Type)["format"]

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

const headers = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const byMorningUserAgent =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ByMorning-User/1.0; +https://bymorning.ai"

const isCloudflareChallenge = (error: unknown): error is HttpClientError.HttpClientError => {
  if (!(error instanceof HttpClientError.HttpClientError)) return false
  if (error.reason._tag !== "StatusCodeError") return false
  const response = error.reason.response
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

const request = (url: string, format: Format, userAgent = byMorningUserAgent) =>
  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers(format, userAgent)))

const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
}

const isRedirect = (status: number) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308

/**
 * Follow one URL's redirect chain by hand: every hop's host is resolved and
 * screened before the request is issued, and the transport pins its connection
 * to the screened answers. The final non-redirect response is returned.
 */
const follow = Effect.fn("WebFetch.follow")(function* (
  http: HttpClient.HttpClient,
  resolve: (hostname: string) => Effect.Effect<ReadonlyArray<string>, Tool.Error>,
  url: string,
  format: Format,
  userAgent: string,
) {
  let current = url
  for (let hop = 0; ; hop++) {
    const parsed = new URL(current)
    yield* resolve(parsed.hostname)
    const response = yield* http.execute(request(current, format, userAgent))
    if (!isRedirect(response.status)) return response
    const location = response.headers["location"]
    if (location === undefined) return response
    // Free the keep-alive connection before the next hop; redirect bodies are not read.
    yield* Stream.runDrain(response.stream).pipe(Effect.ignore)
    const next = new URL(location, parsed)
    yield* Effect.try({
      try: () => assertHttpUrl(next),
      catch: (error) => failure(url, error),
    })
    if (hop >= MAX_REDIRECTS) return yield* new Tool.Error({ message: `Too many redirects fetching ${url}` })
    current = next.href
  }
})

const collectBody = (response: HttpClientResponse.HttpClientResponse) =>
  collectBoundedResponseBody(
    response,
    MAX_RESPONSE_BYTES,
    () => new Tool.Error({ message: `Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)` }),
  )

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"
const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

const failure = (url: string, error: unknown) => {
  if (error instanceof Tool.Error) return error
  return new Tool.Error({
    message: error instanceof Error && error.message ? error.message : `Unable to fetch ${url}`,
    error,
  })
}

/** Build the webfetch Tool over a screened transport and resolver. The transport must not follow redirects itself: `follow` re-screens every hop. */
export const makeTool = (
  http: HttpClient.HttpClient,
  resolve: (hostname: string) => Effect.Effect<ReadonlyArray<string>, Tool.Error> = (hostname) =>
    resolvePublic(hostname),
) =>
  ({
    name,
    options: { codemode: false },
    description,
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type, context: Tool.Context) =>
      Effect.gen(function* () {
        const initial = yield* Effect.try({
          try: () => {
            const url = new URL(input.url)
            assertHttpUrl(url)
            return url
          },
          catch: (error) => failure(input.url, error),
        })
        // Screen the requested destination before permission so a refused
        // address never prompts; each followed hop is screened again.
        yield* resolve(initial.hostname)

        yield* context.permission({
          action: name,
          resources: [input.url],
          save: ["*"],
          metadata: input,
        })

        const { body, contentType } = yield* Effect.gen(function* () {
          const response = yield* follow(http, resolve, input.url, input.format, byMorningUserAgent).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.catchIf(isCloudflareChallenge, () =>
              follow(http, resolve, input.url, input.format, "bymorning").pipe(
                Effect.flatMap(HttpClientResponse.filterStatusOk),
              ),
            ),
          )
          const contentType = response.headers["content-type"] || ""
          const mime = mimeFrom(contentType)
          if (isImageAttachment(mime))
            return yield* new Tool.Error({ message: `Unsupported fetched image content type: ${mime}` })
          if (!isTextualMime(mime))
            return yield* new Tool.Error({ message: `Unsupported fetched file content type: ${mime}` })
          return { body: yield* collectBody(response), contentType }
        }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.seconds(input.timeout ?? DEFAULT_TIMEOUT_SECONDS),
            orElse: () => Effect.fail(new Tool.Error({ message: "Request timed out" })),
          }),
        )
        const content = new TextDecoder().decode(body)
        const output = yield* Effect.try({
          try: () => convert(content, contentType, input.format),
          catch: (error) => failure(input.url, error),
        })
        const result = {
          url: input.url,
          contentType,
          format: input.format,
          output,
        }
        return { output: result, content: result.output, metadata: { contentType: result.contentType } }
      }).pipe(Effect.mapError((error) => failure(input.url, error))),
  }) satisfies Tool.Info<typeof Input, typeof Output>

/**
 * Production construction: a node:http transport whose agent lookup resolves
 * and screens the destination at connection time, pinning sockets to screened
 * addresses and refusing rebound or non-public answers on every hop.
 */
export const makeWebFetch = Effect.gen(function* () {
  const agent = yield* NodeHttpClient.makeAgent({ lookup: makeNodeLookup() })
  const http = yield* NodeHttpClient.makeNodeHttp.pipe(Effect.provideService(NodeHttpClient.HttpAgent, agent))
  return makeTool(http)
})

export const WebFetchToolPlugin = define({
  id: "core.tool.web-fetch",
  effect: (context) =>
    makeWebFetch.pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

export { convertHTMLToMarkdown }
