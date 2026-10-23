import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Effect } from "effect"
import {
  JSON_ATTRIBUTE_COMPARISON,
  allowInsecureRequests,
  discoveryRequest,
  processDiscoveryResponse,
} from "oauth4webapi"

const loopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"

/**
 * Operator-facing explanation of each discovery failure. The issuer origin is
 * operator input; nothing returned by the identity provider is echoed.
 */
const messages = {
  unreachable: (origin: string) =>
    `ByMorning could not reach the identity provider at ${origin}. Check that the Gateway has outbound HTTPS access to it.`,
  mismatch: (origin: string) =>
    `The identity provider's discovery document at ${origin} did not match the issuer. Check the issuer URL.`,
  document: (origin: string) =>
    `The identity provider at ${origin} did not return a valid discovery document for this issuer. Check the issuer URL.`,
  endpoint: (origin: string) =>
    `The identity provider's discovery document at ${origin} does not list an authorization, token, and JWKS endpoint.`,
  grant: (origin: string) => `The identity provider at ${origin} does not support the authorization code flow.`,
  pkce: (origin: string) => `The identity provider at ${origin} does not support PKCE with S256.`,
  "client-auth": (origin: string) =>
    `The identity provider at ${origin} does not accept a client secret (client_secret_basic or client_secret_post).`,
} satisfies Record<string, (origin: string) => string>

const fail = (reason: AuthProvider.DiscoveryError["reason"], message: string) =>
  new AuthProvider.DiscoveryError({ reason, message })

const isMismatch = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === JSON_ATTRIBUTE_COMPARISON

/** Admit an OIDC confidential client at the exact configured issuer. */
export const admit = Effect.fn("AuthProvider.discovery")(function* (issuer: AuthProvider.Issuer) {
  const url = new URL(issuer)
  const origin = url.origin
  const insecureFixture = url.protocol === "http:" && loopback(url.hostname)
  const requestOptions = insecureFixture ? { [allowInsecureRequests]: true } : undefined
  const response = yield* Effect.tryPromise({
    try: () => discoveryRequest(url, requestOptions),
    catch: () => fail("unreachable", messages.unreachable(origin)),
  })
  const metadata = yield* Effect.tryPromise({
    try: () => processDiscoveryResponse(url, response),
    catch: (cause) => fail("issuer", isMismatch(cause) ? messages.mismatch(origin) : messages.document(origin)),
  })
  if (metadata.issuer !== issuer && metadata.issuer !== url.href)
    return yield* fail("issuer", messages.mismatch(origin))
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
    return yield* fail("endpoint", messages.endpoint(origin))
  }
  if (metadata.response_types_supported !== undefined && !metadata.response_types_supported.includes("code")) {
    return yield* fail("grant", messages.grant(origin))
  }
  if (
    metadata.code_challenge_methods_supported !== undefined &&
    !metadata.code_challenge_methods_supported.includes("S256")
  ) {
    return yield* fail("pkce", messages.pkce(origin))
  }
  const methods = metadata.token_endpoint_auth_methods_supported
  if (methods !== undefined && !methods.includes("client_secret_basic") && !methods.includes("client_secret_post")) {
    return yield* fail("client-auth", messages["client-auth"](origin))
  }
})
