// EMULATOR BOUNDARY: stand-ins for the cloud services the Azure Gateway calls at runtime,
// used only by installers/azure/test/kind-e2e.sh. NONE of this is Azure or AWS. It runs in
// the exact release Gateway image (the only Node available) as one in-cluster pod. Hostnames
// reach it through CoreDNS rewrites and a throwaway CA (NODE_EXTRA_CA_CERTS), so the Gateway
// keeps its production endpoints, Azure Government suffixes and TLS verification.
//
//   Entra ID  login.microsoftonline.us
//       token   client_credentials with a client assertion: the projected Kubernetes service
//               account token is verified against the CLUSTER's own issuer and JWKS (signature,
//               iss, aud = api://AzureADTokenExchange, sub, exp) and exchanged for a bearer token
//               for the requested resource (storage or vault). authorization_code sign-in.
//       OIDC    discovery, JWKS, authorize (driven from the control port) for an Entra-shaped
//               identity: no email_verified, xms_edov true, `<tenant>/v2.0` issuer.
//   Key Vault <vault>.vault.usgovcloudapi.net
//       401 challenge (resource https://vault.usgovcloudapi.net), bearer validation, get key
//       (latest and by version), versions, rotate, enable/disable a version, wrapkey/unwrapkey
//       RSA-OAEP-256 with real RSA-2048 keys.
//   AWS STS   AssumeRoleWithWebIdentity, validating the projected token (aud sts.amazonaws.com,
//             sub, role) against the cluster JWKS; returns short-lived fake credentials.
//   Bedrock   bedrock-runtime ConverseStream. Requires the SigV4 access key and session token
//             STS issued; replies with a scripted AWS eventstream.
//
// It does NOT verify Azure RBAC, SigV4 signatures, IAM, Key Vault access policies, or private
// endpoints. Blob storage is real Azurite, not this process. Every request is one JSON log line
// {"emulator":...} and also kept for the control API.
//
// Control API (plain HTTP :8080, driven through a port-forward):
//   GET  /control/events                       all logged events
//   GET  /control/kv/versions                  [{version, enabled}]
//   POST /control/kv/rotate                    -> {version}
//   POST /control/kv/enabled?version=V&value=  enable/disable one version
//   POST /control/idp/authorize                {url, identity} -> {redirect}
//   POST /control/bedrock/script               [{text}|{tool,input,id?}] assistant replies, in order
//   GET  /control/bedrock/requests             parsed ConverseStream requests
//   POST /control/bedrock/reset                clear the script and the recorded requests
import { createHash, createPublicKey, createSign, createVerify, constants, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, verify as verifySignature } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer as createHTTP } from "node:http"
import { createServer as createHTTPS, request as httpsRequest } from "node:https"

const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const tenant = env("TENANT_ID")
const clientID = env("GATEWAY_CLIENT_ID")
const subject = env("GATEWAY_SUBJECT") // system:serviceaccount:<ns>:<name>
const federatedAudience = env("FEDERATED_AUDIENCE")
const vaultName = env("VAULT_NAME")
const keyName = env("KEY_NAME")
const accountName = env("STORAGE_ACCOUNT")
const roleARN = env("AWS_ROLE_ARN")
const awsRegion = env("AWS_REGION")
const authority = "login.microsoftonline.us"
const vaultResource = "https://vault.usgovcloudapi.net"
const issuerURL = `https://${authority}/${tenant}/v2.0`
const idpClientID = env("IDP_CLIENT_ID")
const idpClientSecret = env("IDP_CLIENT_SECRET")
const cert = readFileSync(env("TLS_CERT_FILE"))
const key = readFileSync(env("TLS_KEY_FILE"))

const events = []
const log = (entry) => {
  events.push(entry)
  console.log(JSON.stringify(entry))
}
const b64 = (value) => Buffer.from(value).toString("base64url")
const random = (bytes = 32) => randomBytes(bytes).toString("base64url")

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
const send = (response, status, value, headers = {}) => {
  const isText = typeof value === "string"
  response.writeHead(status, { "content-type": isText ? "text/plain" : "application/json", ...headers })
  response.end(isText ? value : JSON.stringify(value))
}

// ---- Kubernetes issuer trust (the cluster's own projected-token verification) ----
const cluster = { ca: readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt") }
const kube = (path) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "kubernetes.default.svc",
        path,
        ca: cluster.ca,
        headers: { authorization: `Bearer ${readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8").trim()}` },
      },
      async (res) => {
        const body = (await readBody(res)).toString()
        if (res.statusCode !== 200) return reject(new Error(`kube ${path} ${res.statusCode}`))
        resolve(JSON.parse(body))
      },
    )
    req.on("error", reject)
    req.end()
  })
let discovery
const kubeTrust = async () => {
  discovery ??= await kube("/.well-known/openid-configuration")
  return { issuer: discovery.issuer, jwks: (await kube("/openid/v1/jwks")).keys }
}
const decodeJWT = (jwt) => {
  const parts = String(jwt).split(".")
  if (parts.length !== 3) throw new Error("malformed token")
  return {
    header: JSON.parse(Buffer.from(parts[0], "base64url").toString()),
    claims: JSON.parse(Buffer.from(parts[1], "base64url").toString()),
    signed: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  }
}
/** Verifies a projected service account token; throws with the reason when anything is off. */
const verifyProjected = async (jwt, audience) => {
  const token = decodeJWT(jwt)
  const trust = await kubeTrust()
  const jwk = trust.jwks.find((candidate) => candidate.kid === token.header.kid)
  if (!jwk) throw new Error("signing key is not in the cluster JWKS")
  const publicKey = createPublicKey({ key: jwk, format: "jwk" })
  const algorithm = token.header.alg === "RS256" ? "RSA-SHA256" : token.header.alg === "ES256" ? "SHA256" : undefined
  if (!algorithm) throw new Error(`unsupported alg ${token.header.alg}`)
  const ok = verifySignature(algorithm, Buffer.from(token.signed), token.header.alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey, token.signature)
  if (!ok) throw new Error("bad signature")
  if (token.claims.iss !== trust.issuer) throw new Error(`iss ${token.claims.iss} is not the cluster issuer ${trust.issuer}`)
  const audiences = [].concat(token.claims.aud)
  if (!audiences.includes(audience)) throw new Error(`aud ${audiences.join(",")} does not include ${audience}`)
  if (token.claims.sub !== subject) throw new Error(`sub ${token.claims.sub} is not ${subject}`)
  if (token.claims.exp * 1000 < Date.now()) throw new Error("expired")
  return token.claims
}

// ---- Emulator signing key for the bearer tokens it issues ----
const signingPair = generateKeyPairSync("rsa", { modulusLength: 2048 })
const signingKID = random(8)
const signingJWK = { ...signingPair.publicKey.export({ format: "jwk" }), kid: signingKID, use: "sig", alg: "RS256" }
const signJWT = (claims) => {
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: signingKID }))
  const payload = b64(JSON.stringify(claims))
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(signingPair.privateKey).toString("base64url")
  return `${header}.${payload}.${signature}`
}
const verifyOwnJWT = (jwt) => {
  const token = decodeJWT(jwt)
  const ok = createVerify("RSA-SHA256").update(token.signed).end().verify(signingPair.publicKey, token.signature)
  if (!ok) throw new Error("bad signature")
  if (token.claims.exp * 1000 < Date.now()) throw new Error("expired")
  return token.claims
}
const bearer = (request) => /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1]

// ---- Entra ----
const codes = new Map()
const accessTokens = new Map()
const resourceOf = (scope) => scope.replace(/\/\.default$/, "")
const idToken = (code, current) => {
  const now = Math.floor(Date.now() / 1000)
  return signJWT({
    iss: issuerURL,
    sub: code.identity.sub,
    aud: idpClientID,
    exp: now + 300,
    iat: now,
    nbf: now,
    nonce: code.nonce,
    ...(code.identity.email === undefined ? {} : { email: code.identity.email }),
    ...code.identity.extra,
  })
}
const entra = async (request, response, url) => {
  const path = url.pathname
  if (request.method === "GET" && path === `/${tenant}/v2.0/.well-known/openid-configuration`) {
    log({ emulator: "entra", op: "discovery" })
    return send(response, 200, {
      issuer: issuerURL,
      authorization_endpoint: `https://${authority}/${tenant}/oauth2/v2.0/authorize`,
      token_endpoint: `https://${authority}/${tenant}/oauth2/v2.0/token`,
      jwks_uri: `https://${authority}/${tenant}/discovery/v2.0/keys`,
      userinfo_endpoint: "https://graph.microsoft.us/oidc/userinfo",
      response_types_supported: ["code", "id_token", "code id_token", "id_token token"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "private_key_jwt", "client_secret_basic"],
      code_challenge_methods_supported: ["plain", "S256"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
      claims_supported: ["sub", "iss", "aud", "exp", "iat", "name", "email", "tid", "oid", "preferred_username", "xms_edov"],
      tenant_region_scope: "USGov",
      cloud_instance_name: "microsoftonline.us",
    })
  }
  if (request.method === "GET" && path === `/${tenant}/discovery/v2.0/keys`) return send(response, 200, { keys: [signingJWK] })
  if (request.method === "GET" && path === `/${tenant}/oauth2/v2.0/authorize`) return send(response, 200, "authorize is completed through the control port")
  if (request.method === "POST" && path === `/${tenant}/oauth2/v2.0/token`) {
    const form = new URLSearchParams((await readBody(request)).toString())
    const grant = form.get("grant_type")
    if (grant === "client_credentials") {
      const scope = form.get("scope") ?? ""
      const resource = resourceOf(scope)
      const entry = { emulator: "entra", op: "token", grant, scope, resource, client_id: form.get("client_id") }
      try {
        if (form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") throw new Error("client_assertion_type is not jwt-bearer")
        if (form.get("client_id") !== clientID) throw new Error(`unknown client ${form.get("client_id")}`)
        if (!["https://storage.azure.com", vaultResource].includes(resource)) throw new Error(`unsupported resource ${resource}`)
        const claims = await verifyProjected(form.get("client_assertion") ?? "", federatedAudience)
        const now = Math.floor(Date.now() / 1000)
        const accessToken = signJWT({
          aud: resource,
          iss: `https://sts.windows.net/${tenant}/`,
          iat: now,
          nbf: now,
          exp: now + 3600,
          appid: clientID,
          appidacr: "2",
          oid: "00000000-0000-4000-8000-0000000000aa",
          sub: "00000000-0000-4000-8000-0000000000aa",
          tid: tenant,
          idtyp: "app",
          ver: "1.0",
        })
        log({ ...entry, ok: true, assertion_aud: claims.aud, assertion_sub: claims.sub, assertion_iss: claims.iss })
        return send(response, 200, { token_type: "Bearer", expires_in: 3600, ext_expires_in: 3600, access_token: accessToken })
      } catch (error) {
        log({ ...entry, ok: false, reason: error.message })
        return send(response, 400, { error: "invalid_client", error_description: `AADSTS70021: ${error.message}` })
      }
    }
    if (grant === "authorization_code") {
      const basic = /^Basic (.+)$/.exec(request.headers.authorization ?? "")
      const [id, secret] = basic ? Buffer.from(basic[1], "base64").toString().split(":").map(decodeURIComponent) : [form.get("client_id"), form.get("client_secret")]
      if (id !== idpClientID || secret !== idpClientSecret) {
        log({ emulator: "entra", op: "token", grant, ok: false, reason: "invalid client" })
        return send(response, 401, { error: "invalid_client" })
      }
      const code = codes.get(form.get("code") ?? "")
      codes.delete(form.get("code") ?? "")
      const challenge = code && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url")
      if (!code || form.get("redirect_uri") !== code.redirectURI || challenge !== code.challenge) {
        log({ emulator: "entra", op: "token", grant, ok: false, reason: "invalid grant" })
        return send(response, 400, { error: "invalid_grant" })
      }
      const access = random()
      accessTokens.set(access, code.identity)
      log({ emulator: "entra", op: "token", grant, ok: true, sub: code.identity.sub })
      return send(response, 200, { token_type: "Bearer", expires_in: 300, access_token: access, id_token: idToken(code) })
    }
    return send(response, 400, { error: "unsupported_grant_type" })
  }
  return undefined
}

// ---- Key Vault ----
const versions = [] // {version, enabled, publicKey, privateKey, created}
const newVersion = () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const entry = { version: randomBytes(16).toString("hex"), enabled: true, created: Math.floor(Date.now() / 1000), ...pair }
  versions.push(entry)
  return entry
}
newVersion()
const kid = (version) => `https://${vaultName}.vault.usgovcloudapi.net/keys/${keyName}/${version}`
const bundle = (entry) => ({
  key: { kid: kid(entry.version), kty: "RSA", key_ops: ["encrypt", "decrypt", "sign", "verify", "wrapKey", "unwrapKey"], ...entry.publicKey.export({ format: "jwk" }) },
  attributes: { enabled: entry.enabled, created: entry.created, updated: entry.created, recoveryLevel: "Recoverable+Purgeable", recoverableDays: 90 },
})
const vaultError = (response, status, code, message) => send(response, status, { error: { code, message } })
const keyvault = async (request, response, url) => {
  const authorization = bearer(request)
  if (!authorization) {
    log({ emulator: "keyvault", op: "challenge", method: request.method, path: url.pathname })
    return send(response, 401, { error: { code: "Unauthorized", message: "AKV10000: Request is missing a Bearer or PoP token." } }, {
      "www-authenticate": `Bearer authorization="https://${authority}/${tenant}", resource="${vaultResource}"`,
    })
  }
  try {
    const claims = verifyOwnJWT(authorization)
    if (claims.aud !== vaultResource) throw new Error(`aud ${claims.aud}`)
    if (claims.tid !== tenant) throw new Error("tid")
    if (!String(claims.iss).startsWith("https://sts.windows.net/")) throw new Error("iss")
  } catch (error) {
    log({ emulator: "keyvault", op: "auth", ok: false, reason: error.message })
    return vaultError(response, 401, "Unauthorized", `AKV10032: Invalid issuer or audience: ${error.message}`)
  }
  const segments = url.pathname.split("/").filter(Boolean) // keys/<name>[/<version|versions|rotate>[/<op>]]
  if (segments[0] !== "keys" || segments[1] !== keyName) return vaultError(response, 404, "KeyNotFound", "key not found")
  const [, , second, third] = segments
  const entry = (version) => versions.find((candidate) => candidate.version === version)
  const latest = () => versions[versions.length - 1]
  if (request.method === "GET" && second === undefined) {
    log({ emulator: "keyvault", op: "getkey", version: latest().version })
    return send(response, 200, bundle(latest()))
  }
  if (request.method === "GET" && second === "versions") {
    log({ emulator: "keyvault", op: "versions" })
    return send(response, 200, { value: versions.map((candidate) => ({ kid: kid(candidate.version), attributes: bundle(candidate).attributes })) })
  }
  if (request.method === "POST" && second === "rotate") {
    const created = newVersion()
    log({ emulator: "keyvault", op: "rotate", version: created.version })
    return send(response, 200, bundle(created))
  }
  const target = second === undefined ? undefined : entry(second)
  if (second !== undefined && !target) return vaultError(response, 404, "KeyNotFound", `key version ${second} not found`)
  if (request.method === "GET" && third === undefined) {
    log({ emulator: "keyvault", op: "getkey", version: target.version })
    return send(response, 200, bundle(target))
  }
  if (request.method === "POST" && (third === "wrapkey" || third === "unwrapkey")) {
    const input = JSON.parse((await readBody(request)).toString() || "{}")
    const base = { emulator: "keyvault", op: third, version: target.version, alg: input.alg }
    if (!target.enabled) {
      log({ ...base, ok: false, reason: "disabled" })
      return vaultError(response, 403, "Forbidden", `Operation ${third} is not allowed on a disabled key.`)
    }
    if (input.alg !== "RSA-OAEP-256") {
      log({ ...base, ok: false, reason: "algorithm" })
      return vaultError(response, 400, "BadParameter", `unsupported algorithm ${input.alg}`)
    }
    const value = Buffer.from(input.value ?? "", "base64url")
    try {
      const result =
        third === "wrapkey"
          ? publicEncrypt({ key: target.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, value)
          : privateDecrypt({ key: target.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, value)
      log({ ...base, ok: true, bytes: result.length })
      return send(response, 200, { kid: kid(target.version), value: result.toString("base64url") })
    } catch {
      log({ ...base, ok: false, reason: "crypto" })
      return vaultError(response, 400, "BadParameter", "The parameter is incorrect.")
    }
  }
  return vaultError(response, 404, "NotFound", `${request.method} ${url.pathname}`)
}

// ---- AWS STS ----
const issued = new Map() // accessKeyID -> {secret, token}
const xml = (response, status, body) => {
  response.writeHead(status, { "content-type": "text/xml" })
  response.end(body)
}
const sts = async (request, response) => {
  const form = new URLSearchParams((await readBody(request)).toString() || new URL(request.url, "https://x").search.slice(1))
  const entry = { emulator: "sts", op: form.get("Action"), role: form.get("RoleArn"), session: form.get("RoleSessionName") }
  try {
    if (form.get("Action") !== "AssumeRoleWithWebIdentity") throw new Error(`unsupported action ${form.get("Action")}`)
    if (form.get("RoleArn") !== roleARN) throw new Error(`role ${form.get("RoleArn")} is not trusted`)
    const claims = await verifyProjected(form.get("WebIdentityToken") ?? "", "sts.amazonaws.com")
    const accessKeyID = `ASIA${randomBytes(8).toString("hex").toUpperCase()}`
    const credentials = { secret: random(30), token: `FQoG${random(60)}` }
    issued.set(accessKeyID, credentials)
    log({ ...entry, ok: true, aud: claims.aud, sub: claims.sub, iss: claims.iss, accessKeyID })
    return xml(
      response,
      200,
      `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>${accessKeyID}</AccessKeyId><SecretAccessKey>${credentials.secret}</SecretAccessKey><SessionToken>${credentials.token}</SessionToken><Expiration>${new Date(Date.now() + 3600_000).toISOString()}</Expiration></Credentials><AssumedRoleUser><AssumedRoleId>AROAEMULATOR:${entry.session}</AssumedRoleId><Arn>${roleARN.replace(":role/", ":assumed-role/")}/${entry.session}</Arn></AssumedRoleUser><SubjectFromWebIdentityToken>${claims.sub}</SubjectFromWebIdentityToken><Audience>sts.amazonaws.com</Audience></AssumeRoleWithWebIdentityResult><ResponseMetadata><RequestId>${random(8)}</RequestId></ResponseMetadata></AssumeRoleWithWebIdentityResponse>`,
    )
  } catch (error) {
    log({ ...entry, ok: false, reason: error.message })
    return xml(response, 400, `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>InvalidIdentityToken</Code><Message>${error.message}</Message></Error><RequestId>${random(8)}</RequestId></ErrorResponse>`)
  }
}

// ---- Bedrock ConverseStream ----
const crc = (bytes) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const frame = (event, payload) => {
  const headers = Object.entries({ ":message-type": "event", ":event-type": event, ":content-type": "application/json" }).map(([name, text]) => {
    const n = Buffer.from(name)
    const t = Buffer.from(text)
    const bytes = Buffer.alloc(1 + n.length + 1 + 2 + t.length)
    bytes[0] = n.length
    n.copy(bytes, 1)
    bytes[n.length + 1] = 7
    bytes.writeUInt16BE(t.length, n.length + 2)
    t.copy(bytes, n.length + 4)
    return bytes
  })
  const headerSize = headers.reduce((sum, value) => sum + value.length, 0)
  const body = Buffer.from(JSON.stringify(payload))
  const bytes = Buffer.alloc(16 + headerSize + body.length)
  bytes.writeUInt32BE(bytes.length, 0)
  bytes.writeUInt32BE(headerSize, 4)
  bytes.writeUInt32BE(crc(bytes.subarray(0, 8)), 8)
  let offset = 12
  for (const header of headers) {
    header.copy(bytes, offset)
    offset += header.length
  }
  body.copy(bytes, offset)
  bytes.writeUInt32BE(crc(bytes.subarray(0, bytes.length - 4)), bytes.length - 4)
  return bytes
}
const script = []
const bedrockRequests = []
const bedrock = async (request, response, url) => {
  const body = JSON.parse((await readBody(request)).toString() || "{}")
  const authorization = request.headers.authorization ?? ""
  const accessKey = /Credential=([^/]+)\/\d{8}\/([^/]+)\/([^/]+)\/aws4_request/.exec(authorization)
  // A credential the operator saved in the app (static keys, no session token) or one STS issued.
  const staticKey = accessKey?.[1] === env("STATIC_AWS_ACCESS_KEY_ID")
  const credentials = accessKey && (staticKey ? { token: undefined } : issued.get(accessKey[1]))
  const entry = {
    emulator: "bedrock",
    op: "converse-stream",
    path: url.pathname,
    accessKeyID: accessKey?.[1],
    source: staticKey ? "saved-credential" : "sts",
    region: accessKey?.[2],
    service: accessKey?.[3],
  }
  if (!credentials || request.headers["x-amz-security-token"] !== credentials.token || accessKey[2] !== awsRegion || accessKey[3] !== "bedrock") {
    log({ ...entry, ok: false, reason: "credentials were not issued by STS for this region and service" })
    return send(response, 403, { message: "The security token included in the request is invalid." })
  }
  const tools = (body.toolConfig?.tools ?? []).map((tool) => tool.toolSpec?.name)
  const purpose = tools.length === 0 ? "background" : "assistant"
  bedrockRequests.push({ ...entry, purpose, body })
  let steps
  if (purpose === "background") steps = [{ text: "Azure end to end" }]
  else {
    const next = script.shift()
    if (!next) {
      log({ ...entry, ok: false, reason: "no scripted assistant reply" })
      return send(response, 500, { message: "no scripted reply" })
    }
    steps = [next]
  }
  const step = steps[0]
  const events = [frame("messageStart", { role: "assistant" })]
  let stop = "end_turn"
  if (step.tool) {
    if (!tools.includes(step.tool)) {
      log({ ...entry, ok: false, reason: `tool ${step.tool} not offered (${tools.join(",")})` })
      return send(response, 500, { message: "tool not offered" })
    }
    stop = "tool_use"
    const input = JSON.stringify(step.input ?? {})
    events.push(
      frame("contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: step.id ?? "call_e2e", name: step.tool } } }),
      frame("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: input.slice(0, 5) } } }),
      frame("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: input.slice(5) } } }),
    )
  } else events.push(frame("contentBlockDelta", { contentBlockIndex: 0, delta: { text: step.text } }))
  events.push(
    frame("contentBlockStop", { contentBlockIndex: 0 }),
    frame("messageStop", { stopReason: stop }),
    frame("metadata", { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } }),
  )
  log({ ...entry, ok: true, purpose, tool: step.tool, text: step.text })
  response.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" })
  response.end(Buffer.concat(events))
}

// ---- Routing by Host ----
const route = async (request, response) => {
  const host = String(request.headers.host ?? "").split(":")[0]
  const url = new URL(request.url, `https://${host}`)
  try {
    let handled
    if (host === authority) handled = await entra(request, response, url)
    else if (host === `${vaultName}.vault.usgovcloudapi.net`) handled = await keyvault(request, response, url)
    else if (host === `sts.${awsRegion}.amazonaws.com` || host === "sts.amazonaws.com") handled = await sts(request, response)
    else if (host === `bedrock-runtime.${awsRegion}.amazonaws.com` && /^\/model\/[^/]+\/converse-stream$/.test(url.pathname)) handled = await bedrock(request, response, url)
    else {
      log({ emulator: "misrouted", host, method: request.method, path: url.pathname })
      return send(response, 404, { message: `no emulator for ${host}` })
    }
    if (handled === undefined && !response.headersSent) {
      log({ emulator: "unhandled", host, method: request.method, path: url.pathname })
      send(response, 404, { message: `no route ${request.method} ${url.pathname}` })
    }
  } catch (error) {
    log({ emulator: "error", host, path: url.pathname, message: String(error?.stack ?? error) })
    if (!response.headersSent) send(response, 500, { message: "emulator error" })
  }
}
createHTTPS({ cert, key }, (request, response) => void route(request, response)).listen(8443, "0.0.0.0", () => log({ emulator: "ready", port: 8443 }))

// ---- Control (plain HTTP, port-forward only) ----
createHTTP(async (request, response) => {
  const url = new URL(request.url, "http://control")
  try {
    if (request.method === "GET" && url.pathname === "/control/events") return send(response, 200, events)
    if (request.method === "GET" && url.pathname === "/control/kv/versions")
      return send(response, 200, versions.map(({ version, enabled }) => ({ version, enabled })))
    if (request.method === "POST" && url.pathname === "/control/kv/rotate") {
      const created = newVersion()
      log({ emulator: "keyvault", op: "rotate", version: created.version, via: "control" })
      return send(response, 200, { version: created.version })
    }
    if (request.method === "POST" && url.pathname === "/control/kv/enabled") {
      const entry = versions.find((candidate) => candidate.version === url.searchParams.get("version"))
      if (!entry) return send(response, 404, { message: "no such version" })
      entry.enabled = url.searchParams.get("value") === "true"
      log({ emulator: "keyvault", op: "set-enabled", version: entry.version, enabled: entry.enabled, via: "control" })
      return send(response, 200, { version: entry.version, enabled: entry.enabled })
    }
    if (request.method === "POST" && url.pathname === "/control/idp/authorize") {
      const { url: authorizeURL, identity } = JSON.parse((await readBody(request)).toString())
      const params = new URL(authorizeURL).searchParams
      if (
        params.get("client_id") !== idpClientID ||
        params.get("response_type") !== "code" ||
        !params.get("code_challenge") ||
        params.get("code_challenge_method") !== "S256" ||
        !params.get("redirect_uri")
      )
        return send(response, 400, { message: "invalid authorization request" })
      const code = random()
      codes.set(code, { redirectURI: params.get("redirect_uri"), challenge: params.get("code_challenge"), nonce: params.get("nonce") ?? "", identity })
      const redirect = new URL(params.get("redirect_uri"))
      redirect.searchParams.append("code", code)
      if (params.get("state") !== null) redirect.searchParams.append("state", params.get("state"))
      return send(response, 200, { redirect: redirect.href })
    }
    if (request.method === "POST" && url.pathname === "/control/bedrock/script") {
      script.push(...JSON.parse((await readBody(request)).toString()))
      return send(response, 200, { queued: script.length })
    }
    if (request.method === "POST" && url.pathname === "/control/bedrock/reset") {
      script.length = 0
      bedrockRequests.length = 0
      return send(response, 200, { reset: true })
    }
    if (request.method === "GET" && url.pathname === "/control/bedrock/requests") return send(response, 200, bedrockRequests)
    send(response, 404, { message: "not found" })
  } catch (error) {
    send(response, 500, { message: String(error) })
  }
}).listen(8080, "0.0.0.0")
