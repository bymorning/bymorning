// EMULATOR BOUNDARY: a stand-in for the two AWS services the Gateway calls at
// runtime that cannot run locally, used only by test/image-boot.sh. It is NOT AWS:
//
//   KMS  GenerateDataKey / Decrypt  in-memory AES-256-GCM wrapping. Like the task
//        role's IAM condition, it rejects any call whose EncryptionContext is not
//        exactly {"bymorning":"cipher"}.
//   OIDC a discovery document for https://issuer.smoke.test, so a seeded Auth
//        Provider (AUTH_*) is admitted and its client secret is envelope-encrypted.
//   S3   HeadBucket, ListObjectsV2, and (unsigned or aws-chunked) PutObject,
//        GetObject, HeadObject, DeleteObject on one in-memory bucket.
//
// It runs in the candidate image (the only Node available), serves TLS on the
// FIPS endpoint hostnames the image's AWS_USE_FIPS_ENDPOINT=true resolves, and is
// reached through Docker network aliases, so no product default is altered. It
// never verifies SigV4: authentication is out of scope. Every request is logged
// as one JSON line: {"emulator":"kms|s3","op":"...", ...} for assertions.
//
//   node aws-emulator.mjs <key.pem> <cert.pem> <bucket> <region> <kms-key-arn>
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { createServer } from "node:https"
import { readFileSync } from "node:fs"

const [keyFile, certFile, bucket, region, keyARN] = process.argv.slice(2)
if (!keyFile || !certFile || !bucket || !region || !keyARN)
  throw new Error("usage: aws-emulator.mjs <key> <cert> <bucket> <region> <kms-key-arn>")
const master = randomBytes(32)
const objects = new Map()
const log = (entry) => console.log(JSON.stringify(entry))

const body = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })

// Removes aws-chunked framing (size;signature\r\n data \r\n ... 0\r\ntrailers).
const unchunk = (payload) => {
  const parts = []
  let offset = 0
  while (offset < payload.length) {
    const end = payload.indexOf("\r\n", offset)
    if (end === -1) break
    const size = parseInt(payload.subarray(offset, end).toString().split(";")[0], 16)
    if (!Number.isFinite(size) || size === 0) break
    parts.push(payload.subarray(end + 2, end + 2 + size))
    offset = end + 2 + size + 2
  }
  return Buffer.concat(parts)
}

const context = (value) => JSON.stringify(value ?? null)
const wrap = (plaintext, encryption) => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", master, nonce)
  cipher.setAAD(Buffer.from(context(encryption)))
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), sealed])
}
const unwrap = (blob, encryption) => {
  const decipher = createDecipheriv("aes-256-gcm", master, blob.subarray(0, 12))
  decipher.setAAD(Buffer.from(context(encryption)))
  decipher.setAuthTag(blob.subarray(12, 28))
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()])
}

const kms = async (request, response) => {
  const target = String(request.headers["x-amz-target"] ?? "").replace("TrentService.", "")
  const input = JSON.parse((await body(request)).toString() || "{}")
  const reply = (status, payload) => {
    response.writeHead(status, { "content-type": "application/x-amz-json-1.1" })
    response.end(JSON.stringify(payload))
  }
  // Like the task role's policy: only the configured key, and only the pinned context.
  const allowed = input.KeyId === keyARN && context(input.EncryptionContext) === context({ bymorning: "cipher" })
  log({ emulator: "kms", op: target, allowed })
  if (!allowed)
    return reply(400, { __type: "AccessDeniedException", message: "key or encryption context not permitted" })
  if (target === "GenerateDataKey") {
    const plaintext = randomBytes(32)
    return reply(200, {
      KeyId: input.KeyId,
      Plaintext: plaintext.toString("base64"),
      CiphertextBlob: wrap(plaintext, input.EncryptionContext).toString("base64"),
    })
  }
  if (target === "Decrypt") {
    try {
      const plaintext = unwrap(Buffer.from(input.CiphertextBlob, "base64"), input.EncryptionContext)
      return reply(200, { KeyId: input.KeyId, Plaintext: plaintext.toString("base64") })
    } catch {
      return reply(400, { __type: "InvalidCiphertextException", message: "cannot decrypt" })
    }
  }
  return reply(400, { __type: "UnknownOperationException", message: target })
}

const issuer = async (request, response) => {
  log({ emulator: "oidc", op: "discovery", path: request.url })
  await body(request)
  const base = "https://issuer.smoke.test"
  response.writeHead(200, { "content-type": "application/json" })
  response.end(
    JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    }),
  )
}

const s3 = async (request, response) => {
  const url = new URL(request.url ?? "/", "https://s3.emulator")
  const host = String(request.headers.host ?? "").split(":")[0]
  // Virtual-hosted style (<bucket>.s3-fips...) or path style (/<bucket>/key).
  let name = host.split(".s3")[0] === host ? undefined : host.split(".s3")[0]
  let path = decodeURIComponent(url.pathname)
  if (name === undefined || name === "") {
    const [, first, ...rest] = path.split("/")
    name = first
    path = `/${rest.join("/")}`
  }
  const key = path.replace(/^\//, "")
  const method = request.method ?? "GET"
  const op = key === "" ? (method === "HEAD" ? "HeadBucket" : "ListObjectsV2") : `${method} object`
  log({ emulator: "s3", op, bucket: name, key })
  const payload = await body(request)
  const send = (status, headers = {}, text = "") => {
    response.writeHead(status, headers)
    response.end(text)
  }
  const xml = (status, content) => send(status, { "content-type": "application/xml" }, content)
  if (name !== bucket) return xml(404, `<Error><Code>NoSuchBucket</Code><Message>${name}</Message></Error>`)
  if (key === "") {
    if (method === "HEAD") return send(200)
    const prefix = url.searchParams.get("prefix") ?? ""
    const entries = [...objects].filter(([name]) => name.startsWith(prefix))
    return xml(
      200,
      `<ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${entries.length}</KeyCount><IsTruncated>false</IsTruncated>${entries
        .map(([name, value]) => `<Contents><Key>${name}</Key><Size>${value.length}</Size></Contents>`)
        .join("")}</ListBucketResult>`,
    )
  }
  if (method === "PUT") {
    const chunked = String(request.headers["content-encoding"] ?? "").includes("aws-chunked")
    objects.set(key, chunked ? unchunk(payload) : payload)
    return send(200, { etag: '"emulator"' })
  }
  if (method === "DELETE") {
    objects.delete(key)
    return send(204)
  }
  const value = objects.get(key)
  if (value === undefined) return xml(404, "<Error><Code>NoSuchKey</Code></Error>")
  return method === "HEAD"
    ? send(200, { "content-length": String(value.length), etag: '"emulator"' })
    : send(200, { "content-length": String(value.length), etag: '"emulator"' }, value)
}

createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (request, response) => {
  const host = String(request.headers.host ?? "")
  const hostname = host.split(":")[0]
  // Only the hostnames the FIPS-configured SDK must resolve; anything else is a routing failure.
  const route =
    hostname === `kms-fips.${region}.amazonaws.com`
      ? kms
      : hostname === "issuer.smoke.test"
        ? issuer
        : hostname === `${bucket}.s3-fips.${region}.amazonaws.com`
          ? s3
          : undefined
  if (route === undefined) {
    log({ emulator: "misrouted", host })
    response.writeHead(421)
    response.end()
    return
  }
  route(request, response).catch((error) => {
    log({ emulator: "error", message: String(error) })
    response.writeHead(500)
    response.end()
  })
}).listen(443, "0.0.0.0", () => log({ emulator: "ready", bucket }))
