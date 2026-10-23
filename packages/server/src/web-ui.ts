import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { brotliDecompressSync } from "node:zlib"

export type AssetMap = Readonly<Record<string, string | Uint8Array>>
const EncodedAssets = Schema.Record(
  Schema.String,
  Schema.Struct({ content: Schema.String, encoding: Schema.Literals(["utf8", "base64"]) }),
)
const contentTypes = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
} as const
const serverPaths = ["/.well-known", "/auth", "/api", "/inference", "/mcp", "/oauth", "/system"]

/**
 * Content-Security-Policy for the single-page application document.
 *
 * The bundle contains no inline scripts, so script-src stays at 'self'; the
 * 'wasm-unsafe-eval' addition admits the Shiki oniguruma engine compiled in the
 * markdown Worker. style-src keeps 'unsafe-inline' for the inline boot styles
 * and for style attributes emitted by KaTeX and Mermaid. Images allow data: and
 * blob: for embedded markup and object-URL previews; external image beacons are
 * deliberately not admitted.
 */
export const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

/** Minimal browser feature grant; the application needs none of these capabilities. */
export const permissionsPolicy =
  "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()"

/** Security header set for the application document. HSTS is emitted only when the public origin is HTTPS. */
export const security = (https: boolean): Record<string, string> => ({
  "content-security-policy": csp,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": permissionsPolicy,
  "cross-origin-opener-policy": "same-origin",
  ...(https ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
})

const embeddedAssets = import("virtual:bymorning-assets").then(
  (module) => decode(module.default.web),
  () => undefined,
)

export const handler = (input?: { readonly assets?: AssetMap; readonly https?: boolean }) => {
  const assets = input?.assets === undefined ? embeddedAssets : Promise.resolve(input.assets)
  return <E, R>(api: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    api.pipe(
      Effect.catchIf(isRouteNotFound, (error) =>
        Effect.promise(() => assets).pipe(
          Effect.flatMap((files) => {
            if (files === undefined) return Effect.fail(error)
            return HttpServerRequest.HttpServerRequest.pipe(
              Effect.flatMap((request) =>
                serve(request, new URL(request.url, "http://localhost"), files, input?.https === true),
              ),
            )
          }),
        ),
      ),
    )
}

export const layer = (input?: { readonly assets?: AssetMap; readonly https?: boolean }) =>
  HttpRouter.middleware(handler(input), { global: true })

function serve(request: HttpServerRequest.HttpServerRequest, url: URL, assets: AssetMap, https: boolean) {
  if (serverPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)))
    return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
  if (request.method !== "GET" && request.method !== "HEAD")
    return Effect.succeed(HttpServerResponse.empty({ status: 405 }))

  const key = url.pathname.replace(/^\/+/, "")
  if (assets[key] === undefined && (key.startsWith("assets/") || key.includes(".")))
    return Effect.succeed(HttpServerResponse.empty({ status: 404, headers: { "cache-control": "no-store" } }))

  const name = assets[key] === undefined ? "index.html" : key
  const file = assets[name]
  if (file === undefined) return Effect.succeed(HttpServerResponse.empty({ status: 404 }))

  const headers = {
    "content-type": contentType(name),
    "cache-control": name.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
    // The document carries the application security policy; immutable assets keep transport headers only.
    ...(name.endsWith(".html") ? security(https) : {}),
  }
  return Effect.succeed(
    request.method === "HEAD"
      ? HttpServerResponse.empty({ status: 200, headers })
      : HttpServerResponse.raw(file, { headers, contentType: headers["content-type"] }),
  )
}

function decode(archive: string): AssetMap {
  const assets = Schema.decodeUnknownSync(EncodedAssets)(
    JSON.parse(brotliDecompressSync(Buffer.from(archive, "base64")).toString()),
  )
  return Object.fromEntries(
    Object.entries(assets).map(([key, asset]) => [
      key,
      asset.encoding === "utf8" ? asset.content : Buffer.from(asset.content, "base64"),
    ]),
  )
}

function contentType(file: string) {
  const extension = file.slice(file.lastIndexOf(".") + 1)
  return contentTypes[extension as keyof typeof contentTypes] ?? "application/octet-stream"
}

function isRouteNotFound(error: unknown) {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound"
}

export * as WebUi from "./web-ui.js"
