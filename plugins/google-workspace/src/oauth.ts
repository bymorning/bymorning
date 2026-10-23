import { Credential, Integration, Tool } from "@bymorning/plugin"
import type {
  IntegrationOAuthCallbackResponse,
  IntegrationOAuthMethodRegistration,
} from "@bymorning/plugin/promise/integration"
import { Schema } from "effect"
import { requestJSON } from "./http.js"

export const googleAuthorizationURL = "https://accounts.google.com/o/oauth2/v2/auth"
export const googleTokenURL = "https://oauth2.googleapis.com/token"
export const googleUserInfoURL = "https://openidconnect.googleapis.com/v1/userinfo"
export const googleOAuthMethodID = "oauth"

const TokenResponse = Schema.Struct({
  access_token: Schema.String.check(Schema.isMinLength(1)),
  expires_in: Schema.Finite,
  refresh_token: Schema.optionalKey(Schema.String),
})
const UserInfoResponse = Schema.Struct({
  sub: Schema.String.check(Schema.isMinLength(1)),
  email: Schema.String.check(Schema.isMinLength(1)),
})

export interface GoogleOAuthProduct {
  readonly integrationID: string
  /** Display name used in Integration labels and sanitized error messages. */
  readonly product: string
  /** Product-scoped authorization scopes. Never include another product's scopes. */
  readonly authorizationScopes: ReadonlyArray<string>
}

export interface OAuthCallbacks {
  readonly register: () => Promise<{
    readonly state: string
    readonly callbackURI: string
    readonly expiresAt: number
    readonly wait: Promise<IntegrationOAuthCallbackResponse>
  }>
}

/**
 * Member-only Google OAuth web-app method shared by the Workspace products.
 * Secrets travel only in token request bodies; the authorization URL, credential
 * metadata, errors, and logs never carry them.
 */
export function googleOAuth(
  product: GoogleOAuthProduct,
  callbacks: OAuthCallbacks,
): IntegrationOAuthMethodRegistration {
  return {
    integrationID: product.integrationID,
    method: {
      id: googleOAuthMethodID,
      type: "oauth",
      label: "Google OAuth web app",
      client: [
        { key: "client_id", type: "string", title: "OAuth client ID", required: true },
        { key: "client_secret", type: "string", title: "OAuth client secret", required: true, secret: true },
      ],
    },
    authorize: async (_answer, clientAnswer) => {
      const client = requireClient(clientAnswer)
      const verifier = randomVerifier()
      const callback = await callbacks.register()
      const authorization = new URL(googleAuthorizationURL)
      authorization.search = new URLSearchParams({
        client_id: client.clientID,
        redirect_uri: callback.callbackURI,
        response_type: "code",
        scope: product.authorizationScopes.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        code_challenge: await codeChallenge(verifier),
        code_challenge_method: "S256",
        state: callback.state,
      }).toString()
      return {
        mode: "auto" as const,
        url: authorization.href,
        instructions: "Complete Google authorization in your browser, then return to ByMorning.",
        expiresAt: callback.expiresAt,
        callback: (async () => {
          const response = await callback.wait
          if ("error" in response) throw new Error(`${product.product} authorization failed`)
          const token = await exchangeToken(
            {
              client_id: client.clientID,
              client_secret: client.clientSecret,
              code: response.code,
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: callback.callbackURI,
            },
            product.product,
          )
          if (token.refresh_token === undefined) throw new Error(`${product.product} did not return a refresh token`)
          const profile = await userInfo(token.access_token, product.product)
          return Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make(googleOAuthMethodID),
            access: token.access_token,
            refresh: token.refresh_token,
            expires: Date.now() + Math.max(0, token.expires_in) * 1_000,
            metadata: { sub: profile.sub, email: profile.email },
          })
        })(),
      }
    },
    refresh: async (credential, clientAnswer) => {
      const client = requireClient(clientAnswer)
      const token = await exchangeToken(
        {
          client_id: client.clientID,
          client_secret: client.clientSecret,
          refresh_token: credential.refresh,
          grant_type: "refresh_token",
        },
        product.product,
      )
      return Credential.OAuth.make({
        ...credential,
        access: token.access_token,
        refresh: token.refresh_token ?? credential.refresh,
        expires: Date.now() + Math.max(0, token.expires_in) * 1_000,
        metadata: {
          ...(typeof credential.metadata?.sub === "string" ? { sub: credential.metadata.sub } : {}),
          ...(typeof credential.metadata?.email === "string" ? { email: credential.metadata.email } : {}),
        },
      })
    },
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  }
}

function requireClient(clientAnswer: unknown): { readonly clientID: string; readonly clientSecret: string } {
  const record = (typeof clientAnswer === "object" && clientAnswer !== null ? clientAnswer : {}) as Record<
    string,
    unknown
  >
  const clientID = typeof record.client_id === "string" ? record.client_id.trim() : ""
  const clientSecret = typeof record.client_secret === "string" ? record.client_secret.trim() : ""
  if (clientID === "" || clientSecret === "") throw new Error("OAuth client configuration is incomplete")
  return { clientID, clientSecret }
}

async function exchangeToken(parameters: Record<string, string>, product: string): Promise<typeof TokenResponse.Type> {
  const url = new URL(googleTokenURL)
  let value: unknown
  try {
    value = await requestJSON(url, {
      method: "POST",
      body: new URLSearchParams(parameters),
      failure: `${product} token request failed`,
    })
  } catch (error) {
    // requestJSON failures are already sanitized; keep the safe status detail.
    if (error instanceof Tool.Error) throw new Error(error.message)
    throw new Error(`${product} token request failed`)
  }
  try {
    return Schema.decodeUnknownSync(TokenResponse)(value)
  } catch {
    throw new Error(`${product} token response was invalid`)
  }
}

async function userInfo(access: string, product: string): Promise<typeof UserInfoResponse.Type> {
  const url = new URL(googleUserInfoURL)
  let value: unknown
  try {
    value = await requestJSON(url, { access, failure: `${product} userinfo request failed` })
  } catch (error) {
    if (error instanceof Tool.Error) throw new Error(error.message)
    throw new Error(`${product} userinfo request failed`)
  }
  try {
    return Schema.decodeUnknownSync(UserInfoResponse)(value)
  } catch {
    throw new Error(`${product} userinfo response was invalid`)
  }
}

function randomVerifier(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString("base64url")
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString("base64url")
}
