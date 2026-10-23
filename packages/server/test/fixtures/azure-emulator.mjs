// EMULATOR BOUNDARY: stand-ins for the two Azure control-plane services the
// Gateway calls at boot with the Azure selection, used only by
// test/image-boot.sh LEG=azure. It is NOT Azure. Blob Storage is real Azurite,
// not this process. It is the Docker-network sibling of
// installers/azure/test/e2e/emulators.mjs (which verifies projected tokens
// against a kind cluster's JWKS and also emulates STS and Bedrock); here the
// "projected" workload-identity token is minted by the test with a throwaway RSA
// key whose public half this process trusts.
//
//   Entra ID   login.microsoftonline.com
//       token    client_credentials with a jwt-bearer client assertion (what
//                WorkloadIdentityCredential sends): signature against the test
//                key, aud api://AzureADTokenExchange, sub, exp; exchanged for a
//                bearer token for https://storage.azure.com (Azurite --oauth
//                basic accepts it) or https://vault.azure.net.
//       OIDC     discovery and JWKS for the <tenant>/v2.0 issuer, so a seeded
//                AUTH_PROVIDER=microsoft is admitted and its secret encrypted.
//   Key Vault  <vault>.vault.azure.net
//       401 challenge (resource https://vault.azure.net), bearer validation,
//       get key (latest and by version), wrapkey/unwrapkey RSA-OAEP-256 with a
//       real RSA-2048 key.
//
// It never verifies Azure RBAC or Key Vault access policy. Every request is one
// JSON log line {"emulator":"entra|keyvault",...} for the script's assertions.
//
//   node azure-emulator.mjs <key.pem> <cert.pem> <assertion-public-key.pem>
//   env: TENANT_ID CLIENT_ID SUBJECT VAULT_NAME KEY_NAME
import {
  constants,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:https"

const [keyFile, certFile, assertionKeyFile] = process.argv.slice(2)
if (!keyFile || !certFile || !assertionKeyFile)
  throw new Error("usage: azure-emulator.mjs <key> <cert> <assertion-public-key>")
const env = (name) =>
  process.env[name] ||
  (() => {
    throw new Error(`${name} is required`)
  })()
const tenant = env("TENANT_ID")
const clientID = env("CLIENT_ID")
const subject = env("SUBJECT")
const vaultName = env("VAULT_NAME")
const keyName = env("KEY_NAME")
const authority = "login.microsoftonline.com"
const vaultHost = `${vaultName}.vault.azure.net`
const vaultResource = "https://vault.azure.net"
const storageResource = "https://storage.azure.com"
const issuerURL = `https://${authority}/${tenant}/v2.0`
const assertionKey = createPublicKey(readFileSync(assertionKeyFile))

const log = (entry) => console.log(JSON.stringify(entry))
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const body = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
const send = (response, status, value, headers = {}) => {
  response.writeHead(status, {
    "content-type": typeof value === "string" ? "text/plain" : "application/json",
    ...headers,
  })
  response.end(typeof value === "string" ? value : JSON.stringify(value))
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

// ---- Tokens this emulator issues (RS256 with its own key) ----
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 })
const kid = randomBytes(8).toString("base64url")
const jwks = { keys: [{ ...signing.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }] }
const signJWT = (claims) => {
  const signed = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(claims)}`
  return `${signed}.${createSign("RSA-SHA256").update(signed).sign(signing.privateKey).toString("base64url")}`
}
const verifyOwnJWT = (jwt) => {
  const token = decodeJWT(jwt)
  if (!createVerify("RSA-SHA256").update(token.signed).verify(signing.publicKey, token.signature))
    throw new Error("bad signature")
  if (token.claims.exp * 1000 < Date.now()) throw new Error("expired")
  return token.claims
}
/** The workload-identity assertion: minted by image-boot.sh with the key whose public half we hold. */
const verifyAssertion = (jwt) => {
  const token = decodeJWT(jwt)
  if (token.header.alg !== "RS256") throw new Error(`unsupported alg ${token.header.alg}`)
  if (!createVerify("RSA-SHA256").update(token.signed).verify(assertionKey, token.signature))
    throw new Error("assertion signature")
  if (![].concat(token.claims.aud).includes("api://AzureADTokenExchange")) throw new Error(`aud ${token.claims.aud}`)
  if (token.claims.sub !== subject) throw new Error(`sub ${token.claims.sub}`)
  if (token.claims.exp * 1000 < Date.now()) throw new Error("assertion expired")
  return token.claims
}

// ---- Entra ----
const entra = async (request, response, url) => {
  if (request.method === "GET" && url.pathname === `/${tenant}/v2.0/.well-known/openid-configuration`) {
    log({ emulator: "entra", op: "discovery" })
    return send(response, 200, {
      issuer: issuerURL,
      authorization_endpoint: `https://${authority}/${tenant}/oauth2/v2.0/authorize`,
      token_endpoint: `https://${authority}/${tenant}/oauth2/v2.0/token`,
      jwks_uri: `https://${authority}/${tenant}/discovery/v2.0/keys`,
      userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
      response_types_supported: ["code", "id_token", "code id_token", "id_token token"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "private_key_jwt", "client_secret_basic"],
      code_challenge_methods_supported: ["plain", "S256"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
      claims_supported: [
        "sub",
        "iss",
        "aud",
        "exp",
        "iat",
        "name",
        "email",
        "tid",
        "oid",
        "preferred_username",
        "xms_edov",
      ],
      tenant_region_scope: "NA",
      cloud_instance_name: "microsoftonline.com",
    })
  }
  if (request.method === "GET" && url.pathname === `/${tenant}/discovery/v2.0/keys`) return send(response, 200, jwks)
  if (request.method === "POST" && url.pathname === `/${tenant}/oauth2/v2.0/token`) {
    const form = new URLSearchParams((await body(request)).toString())
    const resource = (form.get("scope") ?? "").replace(/\/\.default$/, "")
    const entry = {
      emulator: "entra",
      op: "token",
      grant: form.get("grant_type"),
      resource,
      client_id: form.get("client_id"),
    }
    try {
      if (form.get("grant_type") !== "client_credentials")
        throw new Error(`unsupported grant ${form.get("grant_type")}`)
      if (form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
        throw new Error("client_assertion_type is not jwt-bearer")
      if (form.get("client_id") !== clientID) throw new Error(`unknown client ${form.get("client_id")}`)
      if (![storageResource, vaultResource].includes(resource)) throw new Error(`unsupported resource ${resource}`)
      const claims = verifyAssertion(form.get("client_assertion") ?? "")
      const now = Math.floor(Date.now() / 1000)
      // Shape Azurite's basic OAuth validation accepts: an sts.windows.net issuer and the storage audience.
      const token = signJWT({
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
      log({ ...entry, ok: true, assertion_sub: claims.sub, assertion_aud: claims.aud })
      return send(response, 200, { token_type: "Bearer", expires_in: 3600, ext_expires_in: 3600, access_token: token })
    } catch (error) {
      log({ ...entry, ok: false, reason: error.message })
      return send(response, 400, { error: "invalid_client", error_description: `AADSTS70021: ${error.message}` })
    }
  }
  log({ emulator: "entra", op: "unhandled", method: request.method, path: url.pathname })
  return send(response, 404, { error: "not_found" })
}

// ---- Key Vault: one RSA-2048 key with one version ----
const version = randomBytes(16).toString("hex")
const vaultKey = { ...generateKeyPairSync("rsa", { modulusLength: 2048 }), created: Math.floor(Date.now() / 1000) }
const keyID = `https://${vaultHost}/keys/${keyName}/${version}`
const bundle = () => ({
  key: {
    kid: keyID,
    kty: "RSA",
    key_ops: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    ...vaultKey.publicKey.export({ format: "jwk" }),
  },
  attributes: {
    enabled: true,
    created: vaultKey.created,
    updated: vaultKey.created,
    recoveryLevel: "Recoverable+Purgeable",
    recoverableDays: 90,
  },
})
const vaultError = (response, status, code, message) => send(response, status, { error: { code, message } })
const keyvault = async (request, response, url) => {
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1]
  if (!bearer) {
    log({ emulator: "keyvault", op: "challenge", method: request.method, path: url.pathname })
    return send(
      response,
      401,
      { error: { code: "Unauthorized", message: "AKV10000: Request is missing a Bearer or PoP token." } },
      {
        "www-authenticate": `Bearer authorization="https://${authority}/${tenant}", resource="${vaultResource}"`,
      },
    )
  }
  try {
    const claims = verifyOwnJWT(bearer)
    if (claims.aud !== vaultResource) throw new Error(`aud ${claims.aud}`)
    if (claims.tid !== tenant) throw new Error("tid")
  } catch (error) {
    log({ emulator: "keyvault", op: "auth", ok: false, reason: error.message })
    return vaultError(response, 401, "Unauthorized", `AKV10032: Invalid issuer or audience: ${error.message}`)
  }
  const [first, name, second, third] = url.pathname.split("/").filter(Boolean) // keys/<name>[/<version>[/<op>]]
  if (first !== "keys" || name !== keyName) return vaultError(response, 404, "KeyNotFound", "key not found")
  if (second !== undefined && second !== version)
    return vaultError(response, 404, "KeyNotFound", `key version ${second} not found`)
  if (request.method === "GET" && third === undefined) {
    log({ emulator: "keyvault", op: "getkey", version, by: second === undefined ? "latest" : "version" })
    return send(response, 200, bundle())
  }
  if (request.method === "POST" && (third === "wrapkey" || third === "unwrapkey")) {
    const input = JSON.parse((await body(request)).toString() || "{}")
    const base = { emulator: "keyvault", op: third, version, alg: input.alg }
    if (input.alg !== "RSA-OAEP-256") {
      log({ ...base, ok: false, reason: "algorithm" })
      return vaultError(response, 400, "BadParameter", `unsupported algorithm ${input.alg}`)
    }
    try {
      const value = Buffer.from(input.value ?? "", "base64url")
      const padding = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }
      const result =
        third === "wrapkey"
          ? publicEncrypt({ key: vaultKey.publicKey, ...padding }, value)
          : privateDecrypt({ key: vaultKey.privateKey, ...padding }, value)
      log({ ...base, ok: true, bytes: result.length })
      return send(response, 200, { kid: keyID, value: result.toString("base64url") })
    } catch {
      log({ ...base, ok: false, reason: "crypto" })
      return vaultError(response, 400, "BadParameter", "The parameter is incorrect.")
    }
  }
  log({ emulator: "keyvault", op: "unhandled", method: request.method, path: url.pathname })
  return vaultError(response, 404, "NotFound", `${request.method} ${url.pathname}`)
}

createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (request, response) => {
  const host = String(request.headers.host ?? "").split(":")[0]
  const url = new URL(request.url ?? "/", `https://${host}`)
  // Only the production hostnames the AzureCloud selection resolves; anything else is a routing failure.
  const route = host === authority ? entra : host === vaultHost ? keyvault : undefined
  if (route === undefined) {
    log({ emulator: "misrouted", host, path: url.pathname })
    return send(response, 421, { message: `no emulator for ${host}` })
  }
  route(request, response, url).catch((error) => {
    log({ emulator: "error", host, path: url.pathname, message: String(error?.stack ?? error) })
    if (!response.headersSent) send(response, 500, { message: "emulator error" })
  })
}).listen(443, "0.0.0.0", () => log({ emulator: "ready", vault: vaultHost, version }))
