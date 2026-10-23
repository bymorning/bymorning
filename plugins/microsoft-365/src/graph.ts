import { Buffer } from "node:buffer"
import { Credential, Integration, type Plugin, Tool } from "@bymorning/plugin"
import { Schema } from "effect"

/** Shared Microsoft Graph delegated-access surface for the Microsoft 365 plugins. */
export const microsoft365 = {
  integrationID: "microsoft-365",
  methodID: "oauth",
  graphBase: "https://graph.microsoft.com/v1.0",
  authorizationHost: "https://login.microsoftonline.com",
  defaultTenant: "common",
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "Sites.Read.All",
    "Files.Read",
    "Mail.Read",
    "Mail.Send",
    "Calendars.ReadWrite",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Read.All",
  ],
} as const

export const requestTimeout = 10_000
export const maxJsonBytes = 256 * 1024
export const maxContentBytes = 1024 * 1024

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Union([Schema.Finite, Schema.String]),
  refresh_token: Schema.optionalKey(Schema.String),
})
const ProfileResponse = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  mail: Schema.optionalKey(Schema.String),
  userPrincipalName: Schema.optionalKey(Schema.String),
})

type IntegrationContext = Pick<Plugin.Context, "integration">

export function toolError(message: string) {
  return new Tool.Error({ message })
}

/** Register the shared member-only Microsoft Entra OAuth Integration. Idempotent across plugins. */
export async function registerIntegration(context: IntegrationContext) {
  await context.integration.transform((editor) => {
    editor.update(microsoft365.integrationID, (integration) => {
      integration.name = "Microsoft 365"
      integration.connectionPolicy = "member-only"
    })
    editor.method.update({
      integrationID: microsoft365.integrationID,
      method: {
        id: microsoft365.methodID,
        type: "oauth",
        label: "Microsoft Entra OAuth web app",
        client: [
          { key: "client_id", type: "string", title: "OAuth client ID", required: true },
          { key: "client_secret", type: "string", title: "OAuth client secret", required: true, secret: true },
          {
            key: "tenant_id",
            type: "string",
            title: "Microsoft Entra tenant ID",
            description: "Directory tenant, or common for multi-tenant sign-in.",
            required: false,
          },
        ],
      },
      authorize: async (_answer, clientAnswer) => {
        const client = decodeClient(clientAnswer)
        const verifier = randomBase64Url(64)
        const challenge = await sha256Base64Url(verifier)
        const callback = await context.integration.oauth.callback.register()
        const authorization = new URL(`${microsoft365.authorizationHost}/${client.tenant}/oauth2/v2.0/authorize`)
        authorization.search = new URLSearchParams({
          client_id: client.clientID,
          response_type: "code",
          redirect_uri: callback.callbackURI,
          scope: microsoft365.scopes.join(" "),
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: callback.state,
        }).toString()
        const credential = (async (): Promise<Credential.OAuth> => {
          const response = await callback.wait
          if ("error" in response) throw new Error("Microsoft authorization failed")
          const token = await exchangeToken(tokenURL(client.tenant), {
            client_id: client.clientID,
            client_secret: client.clientSecret,
            code: response.code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: callback.callbackURI,
          })
          if (token.refreshToken === undefined) throw new Error("Microsoft did not return a refresh token")
          const profile = await fetchProfile(token.accessToken)
          return {
            type: "oauth",
            methodID: Integration.MethodID.make(microsoft365.methodID),
            access: token.accessToken,
            refresh: token.refreshToken,
            expires: Date.now() + token.expiresIn * 1_000,
            metadata: profile,
          }
        })()
        return {
          mode: "auto",
          url: authorization.href,
          instructions: "Complete Microsoft authorization in your browser, then return to ByMorning.",
          expiresAt: callback.expiresAt,
          callback: credential,
        }
      },
      refresh: async (credential, clientAnswer) => {
        const client = decodeClient(clientAnswer)
        if (credential.refresh === "") throw new Error("Reconnect Microsoft 365")
        const token = await exchangeToken(tokenURL(client.tenant), {
          client_id: client.clientID,
          client_secret: client.clientSecret,
          refresh_token: credential.refresh,
          grant_type: "refresh_token",
          scope: microsoft365.scopes.join(" "),
        })
        return {
          ...credential,
          access: token.accessToken,
          refresh: token.refreshToken ?? credential.refresh,
          expires: Date.now() + token.expiresIn * 1_000,
          metadata: safeMetadata(credential.metadata),
        }
      },
      label: (credential) =>
        typeof credential.metadata?.mail === "string"
          ? credential.metadata.mail
          : typeof credential.metadata?.id === "string"
            ? credential.metadata.id
            : undefined,
    })
  })
}

/** Resolve the executing member's OAuth access token. Never captures credentials at setup. */
export async function requireOAuth(context: IntegrationContext): Promise<string> {
  const connection = await context.integration.connection.active(microsoft365.integrationID)
  if (connection === undefined) throw toolError("A Microsoft 365 connection is required")
  const credential = await context.integration.connection.resolve(connection)
  if (credential?.type !== "oauth" || credential.access === "") {
    throw toolError("A Microsoft 365 connection is required")
  }
  return credential.access
}

function decodeClient(answer: unknown) {
  if (typeof answer !== "object" || answer === null) {
    throw new Error("OAuth client configuration is incomplete")
  }
  const record = answer as Record<string, unknown>
  const clientID = typeof record.client_id === "string" ? record.client_id.trim() : ""
  const clientSecret = typeof record.client_secret === "string" ? record.client_secret.trim() : ""
  const tenantRaw = record.tenant_id === undefined ? microsoft365.defaultTenant : record.tenant_id
  const tenant = typeof tenantRaw === "string" ? tenantRaw.trim() : ""
  if (clientID === "" || clientSecret === "" || !isTenant(tenant)) {
    throw new Error("OAuth client configuration is incomplete")
  }
  return { clientID, clientSecret, tenant }
}

function isTenant(value: string) {
  if (value === "common" || value === "organizations" || value === "consumers") return true
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)
}

function tokenURL(tenant: string) {
  return `${microsoft365.authorizationHost}/${tenant}/oauth2/v2.0/token`
}

async function exchangeToken(url: string, body: Record<string, string>) {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    })
  } catch {
    throw new Error("Microsoft token request failed")
  }
  if (!response.ok) {
    await discard(response.body)
    throw new Error(`Microsoft token request failed (${response.status})`)
  }
  let value: unknown
  try {
    value = JSON.parse(await readBounded(response, maxJsonBytes))
  } catch {
    throw new Error("Microsoft token response was invalid")
  }
  let token: typeof TokenResponse.Type
  try {
    token = Schema.decodeUnknownSync(TokenResponse)(value)
  } catch {
    throw new Error("Microsoft token response was invalid")
  }
  const expiresIn = typeof token.expires_in === "string" ? Number(token.expires_in) : token.expires_in
  if (!Number.isFinite(expiresIn) || expiresIn < 0) throw new Error("Microsoft token response was invalid")
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn }
}

async function fetchProfile(accessToken: string) {
  const endpoint = new URL("/v1.0/me", microsoft365.graphBase)
  endpoint.search = new URLSearchParams({ $select: "id,displayName,mail,userPrincipalName" }).toString()
  let response: Response
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    })
  } catch {
    throw new Error("Microsoft profile request failed")
  }
  if (!response.ok) {
    await discard(response.body)
    throw new Error(`Microsoft profile request failed (${response.status})`)
  }
  let value: unknown
  try {
    value = JSON.parse(await readBounded(response, maxJsonBytes))
  } catch {
    throw new Error("Microsoft profile response was invalid")
  }
  try {
    const profile = Schema.decodeUnknownSync(ProfileResponse)(value)
    const mail = profile.mail ?? profile.userPrincipalName
    return { id: profile.id, ...(mail === undefined ? {} : { mail }) }
  } catch {
    throw new Error("Microsoft profile response was invalid")
  }
}

function safeMetadata(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null) return undefined
  const record = metadata as Record<string, unknown>
  const id = typeof record.id === "string" ? record.id : undefined
  const mail = typeof record.mail === "string" ? record.mail : undefined
  if (id === undefined && mail === undefined) return undefined
  return { ...(id === undefined ? {} : { id }), ...(mail === undefined ? {} : { mail }) }
}

/** Authenticated Graph GET returning validated-later JSON. Path must start with `/`. */
export async function graphGet(path: string, access: string, headers?: Record<string, string>): Promise<unknown> {
  return graphJson(path, access, undefined, headers)
}

/** Authenticated Graph POST/PUT/PATCH returning validated-later JSON. */
export async function graphWrite(
  path: string,
  access: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
  headers?: Record<string, string>,
): Promise<unknown> {
  return graphJson(path, access, { method, body: JSON.stringify(body) }, headers)
}

/** Authenticated Graph POST whose success body is empty (202/204). */
export async function graphSend(path: string, access: string, body: unknown): Promise<void> {
  const endpoint = new URL(path, microsoft365.graphBase)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    })
  } catch {
    throw toolError("Microsoft Graph request failed")
  }
  if (!response.ok) {
    await discard(response.body)
    throw toolError(`Microsoft Graph request failed (${response.status})`)
  }
  await discard(response.body)
}

async function graphJson(
  path: string,
  access: string,
  init?: { method: string; body: string },
  headers?: Record<string, string>,
) {
  const endpoint = new URL(path, microsoft365.graphBase)
  let response: Response
  try {
    response = await fetch(endpoint, {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        ...(init === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    })
  } catch {
    throw toolError("Microsoft Graph request failed")
  }
  if (!response.ok) {
    await discard(response.body)
    throw toolError(`Microsoft Graph request failed (${response.status})`)
  }
  try {
    return JSON.parse(await readBounded(response, maxJsonBytes))
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/** Authenticated Graph GET for DriveItem content (Word/PowerPoint binaries). Bounded and unsniffed. */
export async function graphBytes(
  path: string,
  access: string,
  maximumBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string | undefined; size: number }> {
  const endpoint = new URL(path, microsoft365.graphBase)
  let response: Response
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${access}` },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    })
  } catch {
    throw toolError("Microsoft Graph request failed")
  }
  if (!response.ok) {
    await discard(response.body)
    throw toolError(`Microsoft Graph request failed (${response.status})`)
  }
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await discard(response.body)
    throw toolError("Microsoft Graph returned an oversized response")
  }
  if (response.body === null) throw toolError("Microsoft Graph returned an invalid response")
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
        throw toolError("Microsoft Graph returned an oversized response")
      }
      chunks.push(chunk.value)
    }
  } catch (error) {
    if (error instanceof Tool.Error) throw error
    throw toolError("Microsoft Graph returned an invalid response")
  } finally {
    reader.releaseLock()
  }
  const contentType = response.headers.get("content-type") ?? undefined
  return { bytes: concat(chunks, size), contentType, size }
}

export async function readBounded(response: Response, maximumBytes: number) {
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

export async function discard(body: ReadableStream<Uint8Array> | null) {
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

function randomBase64Url(bytes: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url")
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Buffer.from(digest).toString("base64url")
}
