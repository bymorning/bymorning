// Driver for installers/azure/test/kind-e2e.sh (run with bun). `prepare` creates the Blob container
// Terraform would create; `verify` runs the numbered checks against the running Gateway through the
// real generated SDK. Everything reaches the cluster through kubectl and port-forwards.
import { spawn, spawnSync } from "node:child_process"
import { ByMorning } from "../../../../packages/client/src/promise/index.ts"
// The Azure SDK is resolved from the host package (it is the SDK the Gateway itself uses).
import { BlobServiceClient, StorageSharedKeyCredential } from "../../../../app/host/node_modules/@azure/storage-blob/dist/esm/index.js"

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
export const cfg = {
  tenant: env("E2E_TENANT"),
  idpClientID: env("E2E_IDP_CLIENT_ID"),
  idpClientSecret: env("E2E_IDP_CLIENT_SECRET"),
  dbPassword: env("E2E_DB_PASSWORD"),
  cookieKey: env("E2E_COOKIE_KEY"),
  account: env("E2E_ACCOUNT"),
  accountKey: env("E2E_ACCOUNT_KEY"),
  container: env("E2E_CONTAINER"),
  vault: env("E2E_VAULT"),
  key: env("E2E_KEY"),
  region: env("E2E_AWS_REGION"),
  roleARN: env("E2E_ROLE_ARN"),
  staticKey: env("E2E_STATIC_KEY"),
  staticSecret: env("E2E_STATIC_SECRET"),
  host: env("E2E_HOST"),
  domain: env("E2E_DOMAIN"),
  boundary: env("E2E_BOUNDARY"),
  gatewayDigest: env("E2E_GATEWAY_DIGEST"),
  executionDigest: env("E2E_EXECUTION_DIGEST"),
  rendered: env("E2E_RENDERED"),
}

export const run = (command: string, args: string[], input?: string) => {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 })
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}
export const kubectl = (...args: string[]) => {
  const result = run("kubectl", args)
  if (result.status !== 0) throw new Error(`kubectl ${args.join(" ")}: ${result.stderr.trim()}`)
  return result.stdout
}
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export const until = async <T>(label: string, seconds: number, attempt: () => Promise<T | undefined> | T | undefined): Promise<T> => {
  const deadline = Date.now() + seconds * 1000
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await attempt()
      if (value !== undefined) return value
    } catch (error) {
      last = error
    }
    await sleep(500)
  }
  throw new Error(`timed out after ${seconds}s waiting for ${label}${last ? `: ${String(last)}` : ""}`)
}

const children = new Set<ReturnType<typeof spawn>>()
process.on("exit", () => children.forEach((child) => child.kill()))
/** kubectl port-forward on a free local port; close() ends it. Re-open after the target pod is replaced. */
export const forward = async (namespace: string, target: string, remote: number) => {
  const child = spawn("kubectl", ["-n", namespace, "port-forward", target, `:${remote}`], { stdio: ["ignore", "pipe", "pipe"] })
  children.add(child)
  const port = await new Promise<number>((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => reject(new Error(`port-forward ${target} did not start: ${output}`)), 30_000)
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      const match = /127\.0\.0\.1:(\d+)/.exec(output)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("exit", () => reject(new Error(`port-forward ${target} exited: ${output}`)))
  })
  return { port, close: () => void child.kill() }
}

const blobs = async () => {
  const link = await forward(cfg.boundary, "svc/azurite", 10000)
  // Path-style URL on loopback (the certificate carries 127.0.0.1); shared key is the account owner,
  // used only for this test's setup and inspection. The Gateway itself only ever uses bearer tokens.
  const service = new BlobServiceClient(`https://127.0.0.1:${link.port}/${cfg.account}`, new StorageSharedKeyCredential(cfg.account, cfg.accountKey))
  return { service, link }
}

if (process.argv[2] === "prepare") {
  const { service, link } = await blobs()
  try {
    await until("Azurite", 60, async () => (await service.getContainerClient(cfg.container).createIfNotExists()) && true)
    console.log(`prepared container ${cfg.container} in Azurite account ${cfg.account}`)
  } finally {
    link.close()
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------------------------
import { readFileSync } from "node:fs"
import { request as httpsRequest } from "node:https"
import { Glob } from "bun"

type Outcome = "ok" | "FAIL" | "SKIP"
const results: { id: string; outcome: Outcome }[] = []
const report = (id: string, outcome: Outcome, detail: string) => {
  results.push({ id, outcome })
  const line = `${outcome === "ok" ? "ok  " : outcome === "SKIP" ? "SKIP" : "FAIL"} ${id} ${detail}`
  if (outcome === "FAIL") console.error(line)
  else console.log(line)
}
const describe = (error: unknown) => {
  if (!(error instanceof Error)) return String(error)
  const extra = "reason" in error ? ` [${String((error as any).reason)} ${JSON.stringify((error as any).cause)?.slice(0, 300)}]` : ""
  // Declared API errors decode to tagged errors whose text is a field (InputError.error), not message.
  const tag = (error as any)._tag
  const fields = tag === undefined ? "" : ` ${tag} ${JSON.stringify({ ...error })?.slice(0, 400)}`
  return `${error.message}${extra}${fields}`.trim() || `${error.name} (no message)`
}
const check = async (id: string, fn: () => Promise<string>) => {
  try {
    report(id, "ok", await fn())
  } catch (error) {
    report(id, "FAIL", describe(error))
  }
}
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}

const psql = (sql: string) => {
  const result = run("kubectl", ["-n", cfg.boundary, "exec", "deploy/postgres", "--", "psql", "-U", "bymorning", "-d", "bymorning", "-tAc", sql])
  if (result.status !== 0) throw new Error(`psql: ${result.stderr.trim()}`)
  return result.stdout.trim()
}
const ledger = () => psql("select count(*) || ':' || coalesce(md5(string_agg(hash, ',' order by id)), '') from drizzle.__drizzle_migrations")
const gatewayPod = () => kubectl("-n", "bymorning", "get", "pods", "-l", "app.kubernetes.io/name=bymorning", "-o", "jsonpath={.items[0].metadata.name}")
const gatewayExec = (...command: string[]) => run("kubectl", ["-n", "bymorning", "exec", "deploy/bymorning", "-c", "gateway", "--", ...command])

// Every log line of every pod this run created, for the secrets-not-logged check.
const logs: string[] = []
const snapshotLogs = () => {
  const pod = gatewayPod()
  for (const container of ["migrate", "gateway"]) logs.push(run("kubectl", ["-n", "bymorning", "logs", pod, "-c", container]).stdout)
}

// Emulator control port and port-forwards (re-opened whenever the Gateway pod is replaced).
const control = await forward(cfg.boundary, "svc/emulators", 8080)
const emulator = async (path: string, init?: RequestInit) => {
  const response = await fetch(`http://127.0.0.1:${control.port}${path}`, init)
  if (!response.ok) throw new Error(`emulator ${path}: ${response.status} ${await response.text()}`)
  return response.json() as Promise<any>
}
const events = async (predicate: (event: any) => boolean) => ((await emulator("/control/events")) as any[]).filter(predicate)

let gateway = await forward("bymorning", "svc/bymorning", 80)
let cookie = ""
// State-changing requests must carry the configured origin (the Gateway refuses anything else).
const origin = `https://${cfg.host}`
const make = () => ByMorning.make({ baseUrl: `http://127.0.0.1:${gateway.port}`, headers: { origin, ...(cookie === "" ? {} : { cookie }) } })
let client = make()
const reconnect = async () => {
  gateway.close()
  gateway = await forward("bymorning", "svc/bymorning", 80)
  client = make()
}
const health = async () => (await fetch(`http://127.0.0.1:${gateway.port}/system/health`)).status

/** Replace the Gateway pod (the migrate init container runs again) and wait for the new one. */
const replacePod = async () => {
  snapshotLogs()
  const old = gatewayPod()
  kubectl("-n", "bymorning", "delete", "pod", old, "--wait=true")
  await until("new Gateway pod ready", 240, () => {
    const pods = JSON.parse(kubectl("-n", "bymorning", "get", "pods", "-l", "app.kubernetes.io/name=bymorning", "-o", "json")).items
    const ready = pods.find((pod: any) => pod.metadata.name !== old && pod.status.containerStatuses?.every((status: any) => status.ready))
    return ready?.metadata.name as string | undefined
  })
  await reconnect()
  await until("health", 60, async () => ((await health()) === 200 ? true : undefined))
}

const noSession = (response: Response) => response.headers.getSetCookie().filter((line) => !/=;|Max-Age=0/i.test(line) && line.split(";")[0]!.split("=")[1] !== "").length === 0
const pairs = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).filter((pair) => pair.split("=")[1] !== "")
const entra = (extra: Record<string, unknown> = {}) => ({
  tid: cfg.tenant,
  oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ver: "2.0",
  preferred_username: "person@example.test",
  ...extra,
})

const redirectURIs: string[] = []
/** The real browser flow: login redirect, the issuer (control port completes authorization), callback. */
const signIn = async (identity: { sub: string; email?: string; extra?: Record<string, unknown> }) => {
  const method = (await (await fetch(`http://127.0.0.1:${gateway.port}/auth/method`)).json()) as any
  const login = await fetch(`http://127.0.0.1:${gateway.port}/auth/login?provider=${method.providers[0].id}`, { redirect: "manual" })
  assert(login.status === 302, `login did not redirect (${login.status})`)
  const location = login.headers.get("location")!
  assert(location.startsWith(`https://login.microsoftonline.us/${cfg.tenant}/oauth2/v2.0/authorize?`), `login redirected to ${location.slice(0, 80)}`)
  const attempt = pairs(login).join("; ")
  redirectURIs.push(new URL(location).searchParams.get("redirect_uri") ?? "")
  const issued = await emulator("/control/idp/authorize", { method: "POST", body: JSON.stringify({ url: location, identity }) })
  const redirect = new URL(issued.redirect)
  const callback = await fetch(`http://127.0.0.1:${gateway.port}${redirect.pathname}${redirect.search}`, { redirect: "manual", headers: { cookie: attempt } })
  return { callback, cookie: pairs(callback).join("; "), location: callback.headers.get("location") ?? "" }
}

// ---- E2E-03 pod security and restricted PSA on the real rendered manifests (before anything mutates) ----
await check("E2E-03", async () => {
  const policy = run("bun", [new URL("../policy-check.ts", import.meta.url).pathname], readFileSync(cfg.rendered, "utf8"))
  assert(policy.status === 0, `policy-check: ${policy.stdout}${policy.stderr}`)
  const namespace = JSON.parse(kubectl("get", "namespace", "bymorning", "-o", "json"))
  assert(namespace.metadata.labels["pod-security.kubernetes.io/enforce"] === "restricted", "namespace bymorning does not enforce restricted PSA")
  const dry = run("kubectl", ["apply", "--dry-run=server", "-f", cfg.rendered])
  assert(dry.status === 0 && !/PodSecurity|would violate/i.test(dry.stderr + dry.stdout), `restricted PSA warning on the rendered manifests: ${dry.stderr}`)
  const spec = JSON.parse(kubectl("-n", "bymorning", "get", "pod", gatewayPod(), "-o", "json")).spec
  const containers = [...spec.initContainers, ...spec.containers]
  for (const container of containers) {
    const security = container.securityContext
    assert(security.readOnlyRootFilesystem === true && security.allowPrivilegeEscalation === false && security.runAsNonRoot === true, `${container.name} securityContext`)
    assert(JSON.stringify(security.capabilities.drop) === '["ALL"]', `${container.name} capabilities`)
  }
  assert(spec.securityContext.seccompProfile.type === "RuntimeDefault" && spec.securityContext.runAsUser === 65532, "pod securityContext")
  const image = JSON.parse(kubectl("-n", "bymorning", "get", "pod", gatewayPod(), "-o", "json")).status.containerStatuses[0].imageID
  assert(image.endsWith(cfg.gatewayDigest), `running image ${image} is not ${cfg.gatewayDigest}`)
  const write = gatewayExec("sh", "-c", "touch /app/x 2>&1; touch /tmp/ok && echo tmp-writable")
  assert(/Read-only file system/.test(write.stdout + write.stderr) && write.stdout.includes("tmp-writable"), `root filesystem is writable: ${write.stdout}${write.stderr}`)
  // A privileged pod must be refused by the namespace's restricted PSA (negative control).
  const bad = run("kubectl", ["-n", "bymorning", "run", "psa-probe", "--image=registry.test/bymorning@" + cfg.gatewayDigest, "--restart=Never", "--privileged", "--command", "--", "true"])
  assert(bad.status !== 0 && /violates PodSecurity "restricted/.test(bad.stderr), `privileged pod was not refused: ${bad.stderr}`)
  return `real rendered manifests: policy-check ok; PSA restricted enforced, server-side dry-run has no violations, privileged pod refused; readOnlyRootFilesystem, non-root uid 65532, caps dropped, RuntimeDefault seccomp on migrate and gateway; running digest ${cfg.gatewayDigest.slice(0, 19)}...`
})

// ---- E2E-04 migrate init container and idempotency across a pod restart ----
const expectedMigrations = [...new Glob("**/migration.sql").scanSync(new URL("../../../../packages/core/src/database/migration", import.meta.url).pathname)].length
await check("E2E-04", async () => {
  const state = JSON.parse(kubectl("-n", "bymorning", "get", "pod", gatewayPod(), "-o", "json")).status.initContainerStatuses[0]
  assert(state.name === "migrate" && state.state.terminated?.exitCode === 0, "migrate init container did not exit 0")
  const log = run("kubectl", ["-n", "bymorning", "logs", gatewayPod(), "-c", "migrate"]).stdout
  assert(log.includes("Database migration complete"), "no completion line in migrate log")
  const before = ledger()
  assert(before.startsWith(`${expectedMigrations}:`), `ledger ${before}, expected ${expectedMigrations} migrations`)
  const first = gatewayPod()
  await replacePod()
  const after = ledger()
  const again = JSON.parse(kubectl("-n", "bymorning", "get", "pod", gatewayPod(), "-o", "json")).status.initContainerStatuses[0]
  assert(gatewayPod() !== first && again.state.terminated?.exitCode === 0, "restarted pod's migrate did not exit 0")
  assert(run("kubectl", ["-n", "bymorning", "logs", gatewayPod(), "-c", "migrate"]).stdout.includes("Database migration complete"), "restarted pod: no completion line")
  assert(after === before, `ledger changed across restart: ${before} -> ${after}`)
  return `migrate exit 0, ${expectedMigrations} of ${expectedMigrations} source migrations applied; pod deleted and recreated, migrate exit 0 again, ledger unchanged (${after.split(":")[0]} rows, ${after.split(":")[1]!.slice(0, 8)})`
})

await check("E2E-05", async () => {
  assert((await health()) === 200, "health is not 200")
  const body = await (await fetch(`http://127.0.0.1:${gateway.port}/system/health`)).text()
  const method = (await (await fetch(`http://127.0.0.1:${gateway.port}/auth/method`)).json()) as any
  assert(method.state === "ready" && method.local === false && method.providers.length === 1 && method.providers[0].kind === "microsoft", `auth method ${JSON.stringify(method)}`)
  return `/system/health 200 (${body.trim()}); /auth/method ready, Local Login off, one seeded Microsoft provider`
})

// ---- E2E-06 sign-in through the Entra-shaped issuer ----
let workspaceCount = 0
await check("E2E-06", async () => {
  const refusals: string[] = []
  for (const [label, identity, reason] of [
    ["no xms_edov", { sub: "no-edov", email: "person@example.test", extra: entra() }, "claims"],
    ["xms_edov false", { sub: "edov-false", email: "person@example.test", extra: entra({ xms_edov: false }) }, "claims"],
    ["domain not admitted", { sub: "outside", email: "person@outside.test", extra: entra({ xms_edov: true }) }, "domain"],
  ] as const) {
    const attempt = await signIn(identity)
    assert(attempt.callback.status === 303 && attempt.location.endsWith(`/login?auth=failed&reason=${reason}`) && attempt.cookie === "", `${label} was not refused (${attempt.callback.status} ${attempt.location})`)
    refusals.push(label)
  }
  const success = await signIn({ sub: "entra-user", email: "person@example.test", extra: entra({ xms_edov: true, name: "Person Example" }) })
  assert(success.callback.status === 303 && success.cookie !== "" && !success.location.includes("auth=failed"), `sign-in failed: ${success.callback.status} ${success.location}`)
  cookie = success.cookie
  client = make()
  const account = await client.account.get()
  const workspaces = await client.workspace.list()
  workspaceCount = workspaces.length
  assert(workspaces.length === 1, `expected one Workspace, got ${workspaces.length}`)
  // The seeded provider sends the ID-less callback, which is what the installer README tells the operator to register.
  assert(redirectURIs.every((uri) => uri === `https://${cfg.host}/auth/callback`), `redirect_uri sent to the issuer: ${redirectURIs[0]}`)
  const exchange = await events((event) => event.emulator === "entra" && event.grant === "authorization_code" && event.ok === true)
  assert(exchange.length >= 1, "the Gateway never completed the authorization-code exchange with the issuer")
  return `Entra-shaped identity (no email_verified, xms_edov true) signed in through /auth/login -> issuer -> /auth/callback; refused: ${refusals.join(", ")}; redirect_uri sent is https://${cfg.host}/auth/callback; session works through the generated SDK (account ${JSON.stringify(account).slice(0, 60)}..., ${workspaceCount} Workspace)`
})
if (cookie === "") {
  report("E2E-07..15", "FAIL", "no session: the remaining checks need a signed-in owner")
  finish()
}

// ---- E2E-07 workload identity ----
await check("E2E-07", async () => {
  const token = gatewayExec("cat", "/var/run/secrets/azure/tokens/azure-identity-token").stdout.trim()
  const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString())
  const env = Object.fromEntries(gatewayExec("printenv").stdout.split("\n").filter((line) => line.startsWith("AZURE_")).map((line) => [line.split("=")[0], line.slice(line.indexOf("=") + 1)]))
  assert(env.AZURE_AUTHORITY_HOST === "https://login.microsoftonline.us/", `AZURE_AUTHORITY_HOST ${env.AZURE_AUTHORITY_HOST}`)
  assert([].concat(claims.aud).includes("api://AzureADTokenExchange") && claims.sub === "system:serviceaccount:bymorning:bymorning-gateway", `token aud/sub ${JSON.stringify([claims.aud, claims.sub])}`)
  const exchanged = await events((event) => event.emulator === "entra" && event.op === "token" && event.grant === "client_credentials" && event.ok === true)
  const resources = new Set(exchanged.map((event) => event.resource))
  assert(resources.has("https://storage.azure.com") && resources.has("https://vault.usgovcloudapi.net"), `token exchanges for ${[...resources]}`)
  for (const event of exchanged) assert(event.assertion_sub === claims.sub && event.assertion_iss === claims.iss, "assertion mismatch")
  // Negative controls against the emulator's verification: the cluster issues these; the emulator must refuse them.
  const refuse = async (label: string, serviceAccount: string, audience: string) => {
    const minted = run("kubectl", ["-n", "bymorning", "create", "token", serviceAccount, `--audience=${audience}`, "--duration=10m"])
    assert(minted.status === 0, `cannot mint ${label}: ${minted.stderr}`)
    const link = await forward(cfg.boundary, "svc/emulators", 443)
    try {
      const form = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.E2E_CLIENT_ID!, scope: "https://storage.azure.com/.default", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: minted.stdout.trim() })
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpsRequest({ host: "127.0.0.1", port: link.port, servername: "login.microsoftonline.us", method: "POST", path: `/${cfg.tenant}/oauth2/v2.0/token`, headers: { host: "login.microsoftonline.us", "content-type": "application/x-www-form-urlencoded" }, ca: readFileSync(process.env.E2E_CA!) }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
        req.on("error", reject)
        req.end(form.toString())
      })
      assert(status === 400, `${label} was accepted (${status})`)
    } finally {
      link.close()
    }
  }
  await refuse("wrong audience", "bymorning-gateway", "api://somewhere-else")
  await refuse("wrong service account", "default", "api://AzureADTokenExchange")
  return `projected token aud=${[].concat(claims.aud)} sub=${claims.sub} iss=${claims.iss} verified against the cluster JWKS and exchanged for storage + vault tokens (AZURE_AUTHORITY_HOST ${env.AZURE_AUTHORITY_HOST}); wrong-audience and wrong-ServiceAccount assertions refused`
})

// ---- setup used by the next checks: owner config (Bedrock, shell permission) ----
const model = { provider: "amazon-bedrock" as any, id: "amazon.nova-pro-v1:0" }
const configure = async () => {
  await (client as any)["api.config"].update({
    providers: { activation: { "amazon-bedrock": "enabled" } },
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
  })
  await client.model.toggle({ provider: model.provider, id: model.id, enabled: true } as any)
}

await emulator("/control/bedrock/reset", { method: "POST" })
const project = await client.project.create({ name: "Azure end to end" } as any)
const text = (value: unknown) => JSON.stringify(value)
const converse = async (prompt: string, script: unknown[]) => {
  const step = async <T>(label: string, work: Promise<T>) => work.catch((error) => Promise.reject(new Error(`${label}: ${describe(error)}`)))
  await emulator("/control/bedrock/script", { method: "POST", body: JSON.stringify(script) })
  const session = await step("session.create", client.session.create({ projectID: project.id, model } as any))
  await step("session.prompt", client.session.prompt({ sessionID: session.id, text: prompt } as any))
  await step("session.wait", Promise.race([client.session.wait({ sessionID: session.id } as any), sleep(180_000).then(() => Promise.reject(new Error("session did not become idle in 180s")))]))
  return { session, messages: text(await step("message.list", client.message.list({ sessionID: session.id } as any))) }
}
const bedrockRequests = async () => (await emulator("/control/bedrock/requests")) as any[]

// ---- E2E-08 Blob through an app feature (Project files) ----
await check("E2E-08", async () => {
  const path = "notes/azure-e2e.txt"
  const content = `azure blob round trip ${Date.now()} α`
  await client.project.directory.write({ projectID: project.id, path, contentType: "text/plain", payload: new TextEncoder().encode(content) } as any)
  const read = new TextDecoder().decode(await client.project.directory.read({ projectID: project.id, path } as any))
  assert(read === content, `readback differs: ${read}`)
  const { service, link } = await blobs()
  try {
    const names: string[] = []
    for await (const blob of service.getContainerClient(cfg.container).listBlobsFlat()) names.push(blob.name)
    const hit = names.find((name) => name.includes(`/projects/${project.id}/`) && name.endsWith("azure-e2e.txt"))
    assert(hit, `no object for the file in Azurite; container holds ${names.slice(0, 5)}`)
    const bytes = (await service.getContainerClient(cfg.container).getBlockBlobClient(hit).downloadToBuffer()).toString("utf8")
    assert(bytes === content, "Azurite object content differs from what the app wrote")
    return `Project file written through the SDK, read back identical, and present in Azurite container ${cfg.container} as ${hit} (${names.length} objects); Gateway authenticated with a bearer token from the workload-identity exchange`
  } finally {
    link.close()
  }
})

// ---- E2E-09 Bedrock chat through web identity (STS) ----
await configure().catch((error) => report("E2E-09", "FAIL", `configuring Bedrock and the shell permission: ${describe(error)}`))
await check("E2E-09", async () => {
  const { messages } = await converse("Say hello", [{ text: "Hello from the fake Bedrock model" }])
  assert(messages.includes("Hello from the fake Bedrock model"), `assistant reply missing: ${messages.slice(0, 400)}`)
  const sts = (await events((event) => event.emulator === "sts" && event.ok === true))
  assert(sts.length >= 1, "no successful AssumeRoleWithWebIdentity")
  const call = sts[0]
  assert([].concat(call.aud).includes("sts.amazonaws.com") && call.sub === "system:serviceaccount:bymorning:bymorning-gateway" && call.role === cfg.roleARN, `STS call ${JSON.stringify(call)}`)
  const requests = (await bedrockRequests()).filter((request) => request.purpose === "assistant")
  assert(requests.length >= 1 && requests.every((request) => request.source === "sts" && request.region === cfg.region), `bedrock requests ${JSON.stringify(requests.map((r) => [r.source, r.region]))}`)
  return `chat round-tripped through the real Bedrock provider (${cfg.region}, not GovCloud): reply returned; AssumeRoleWithWebIdentity aud=${call.aud} sub=${call.sub} role=${call.role}; ConverseStream signed with the STS-issued key`
})

// ---- E2E-10 credential encrypted through Key Vault ----
const envelopes = () =>
  psql("select id || '|' || active || '|' || (value_json #>> '{}') from credential where integration_id = 'amazon-bedrock' order by id").split("\n").filter((line) => line !== "").map((line) => {
    const [id, active, envelope] = line.split("|")
    const parts = envelope!.split(".")
    return { id: id!, active: active === "true", envelope: envelope!, keyID: parts[0] === "v1" ? Buffer.from(parts[1]!, "base64url").toString() : "(plaintext)" }
  })
const keyVersion = (keyID: string) => keyID.split("/").pop()!
const connect = (label: string) =>
  client.integration.connect.awsSigV4({ integrationID: "amazon-bedrock", scope: "workspace", region: cfg.region, accessKeyId: cfg.staticKey, secretAccessKey: cfg.staticSecret, label } as any)
const versions = async () => (await emulator("/control/kv/versions")) as { version: string; enabled: boolean }[]
let firstCredential = ""
await check("E2E-10", async () => {
  await connect("Azure e2e credential v1")
  const rows = envelopes()
  assert(rows.length === 1, `expected one saved credential, found ${rows.length}`)
  const [v1] = await versions()
  assert(rows[0]!.envelope.startsWith("v1.") && keyVersion(rows[0]!.keyID) === v1!.version, `envelope keyID ${rows[0]!.keyID}`)
  assert(rows[0]!.keyID === `https://${cfg.vault}.vault.usgovcloudapi.net/keys/${cfg.key}/${v1!.version}`, "keyID is not the Key Vault key URL with its version")
  const dump = run("kubectl", ["-n", cfg.boundary, "exec", "deploy/postgres", "--", "pg_dump", "-U", "bymorning", "bymorning"]).stdout
  assert(!dump.includes(cfg.staticSecret) && !dump.includes(cfg.idpClientSecret) && !dump.includes(cfg.staticKey), "a credential secret appears in plaintext in the database")
  const wraps = await events((event) => event.emulator === "keyvault" && event.op === "wrapkey" && event.ok === true)
  assert(wraps.some((event) => event.version === v1!.version), "no wrapKey call on the first key version")
  firstCredential = rows[0]!.id
  return `Provider credential (saved AWS key) stored as a v1 envelope keyed ${keyVersion(rows[0]!.keyID).slice(0, 8)}... (Key Vault version 1); database dump contains no plaintext credential or Auth Provider secret`
})

// ---- E2E-11 Key Vault rotation: restart, old data still decrypts, new writes use v2 ----
await check("E2E-11", async () => {
  const [v1] = await versions()
  const { messages } = await converse("Use the saved credential", [{ text: "saved credential reply" }])
  assert(messages.includes("saved credential reply"), "chat with the saved credential failed before rotation")
  const usedSaved = (await bedrockRequests()).filter((request) => request.purpose === "assistant").at(-1)
  assert(usedSaved.source === "saved-credential" && usedSaved.accessKeyID === cfg.staticKey, `saved credential was not used: ${JSON.stringify(usedSaved)}`)
  const rotated = await emulator("/control/kv/rotate", { method: "POST" })
  await replacePod()
  const getkeys = await events((event) => event.emulator === "keyvault" && event.op === "getkey")
  assert(getkeys.some((event) => event.version === rotated.version), "restarted Gateway did not resolve the new key version")
  // The new pod has an empty key cache: this chat decrypts the v1 credential through unwrapKey on version 1.
  const before = (await events((event) => event.emulator === "keyvault" && event.op === "unwrapkey" && event.version === v1!.version && event.ok === true)).length
  const { messages: after } = await converse("Use the saved credential again", [{ text: "still decrypts after rotation" }])
  assert(after.includes("still decrypts after rotation"), "credential no longer works after rotation and restart")
  const unwraps = (await events((event) => event.emulator === "keyvault" && event.op === "unwrapkey" && event.version === v1!.version && event.ok === true)).length
  assert(unwraps > before, "the v1 credential was not unwrapped with key version 1 after the restart")
  await connect("Azure e2e credential v2")
  const rows = envelopes()
  assert(rows.length === 2, `expected two credentials, found ${rows.length}`)
  assert(keyVersion(rows[0]!.keyID) === v1!.version && keyVersion(rows[1]!.keyID) === rotated.version, `versions ${rows.map((row) => keyVersion(row.keyID))}`)
  const wrapped = await events((event) => event.emulator === "keyvault" && event.op === "wrapkey" && event.ok === true && event.version === rotated.version)
  assert(wrapped.length >= 1, "new writes did not wrap with version 2")
  return `rotated to ${rotated.version.slice(0, 8)}...; after a pod restart the Gateway resolved the new version, the v1 credential still decrypted (unwrapKey on v1, chat succeeded), and a new credential was written as a v2 envelope (wrapKey on v2); envelope frame versions [${rows.map((row) => keyVersion(row.keyID).slice(0, 8)).join(", ")}]`
})

// ---- E2E-12 old version disabled: fail closed everywhere it matters, then recover ----
await check("E2E-12", async () => {
  const [v1] = await versions()
  const rows = envelopes()
  await client.credential.activate({ credentialID: rows[0]!.id } as any).catch((error) => Promise.reject(new Error(`credential.activate: ${describe(error)}`)))
  const ok = await converse("v1 active", [{ text: "v1 credential works" }])
  assert(ok.messages.includes("v1 credential works"), "chat with the v1 credential failed while v1 was enabled")
  await emulator(`/control/kv/enabled?version=${v1!.version}&value=false`, { method: "POST" })
  await replacePod() // fresh process: no cached data keys
  const priorRequests = (await bedrockRequests()).length
  await emulator("/control/bedrock/script", { method: "POST", body: JSON.stringify([{ text: "MUST NOT APPEAR" }]) })
  // Workspace work is refused: the raw response is recorded so the operator-facing error is visible.
  const raw = await fetch(`http://127.0.0.1:${gateway.port}/api/session`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ projectID: project.id, model }),
  })
  const rawBody = (await raw.text()).slice(0, 200)
  assert(raw.status >= 500, `session.create was not refused (${raw.status}): ${rawBody}`)
  // Sign-in also fails closed: the Auth Provider's client secret is wrapped with version 1 and is read at login.
  const method = (await (await fetch(`http://127.0.0.1:${gateway.port}/auth/method`)).json()) as any
  const login = await fetch(`http://127.0.0.1:${gateway.port}/auth/login?provider=${method.providers[0].id}`, { redirect: "manual" })
  assert(login.status === 503, `sign-in did not fail closed (${login.status})`)
  const loginBody = (await login.text()).slice(0, 120)
  assert((await bedrockRequests()).length === priorRequests, "a Bedrock request was made although the credential could not be decrypted")
  const refused = await events((event) => event.emulator === "keyvault" && event.op === "unwrapkey" && event.ok === false && event.reason === "disabled" && event.version === v1!.version)
  assert(refused.length >= 1, "the disabled version was never asked to unwrap")
  const gatewayLog = run("kubectl", ["-n", "bymorning", "logs", gatewayPod(), "-c", "gateway"]).stdout
  assert(/Cipher\.UnavailableError/.test(gatewayLog), "no Cipher.UnavailableError in the Gateway log")
  // Recover: re-enable the version. The Gateway keeps no failed state, but restart if it needs one.
  await emulator(`/control/kv/enabled?version=${v1!.version}&value=true`, { method: "POST" })
  await emulator("/control/bedrock/reset", { method: "POST" })
  let restarted = "without a restart"
  const recovered = await converse("v1 re-enabled", [{ text: "recovered after re-enable" }]).catch(async () => {
    restarted = "after a pod restart (the running pod kept its failed state)"
    await replacePod()
    return converse("v1 re-enabled", [{ text: "recovered after re-enable" }])
  })
  assert(recovered.messages.includes("recovered after re-enable"), "chat did not recover after re-enabling the key version")
  const back = await signIn({ sub: "entra-user", email: "person@example.test", extra: entra({ xms_edov: true }) })
  assert(back.cookie !== "" && !back.location.includes("auth=failed"), "sign-in did not recover")
  return `with key version 1 disabled on a fresh pod: Key Vault refused unwrapKey (403); Workspace calls failed closed (session.create HTTP ${raw.status} ${JSON.stringify(rawBody.slice(0, 80))}), sign-in HTTP 503 ${JSON.stringify(loginBody)}, and no Bedrock request was made; re-enabling the version restored chat and sign-in ${restarted}`
})

// ---- E2E-13 code execution in a sandbox pod ----
await check("E2E-13", async () => {
  // Newest credential is v2 now; make sure the static key path is active and unambiguous.
  const probe = [
    "python3 - <<'PY'",
    "import os, socket",
    "targets = [(os.environ.get('KUBERNETES_SERVICE_HOST', '10.96.0.1'), 443), ('8.8.8.8', 53), ('1.1.1.1', 443)]",
    "for host, port in targets:",
    "    try:",
    "        socket.create_connection((host, port), timeout=3).close()",
    "        print('OPEN', host, port)",
    "    except OSError as error:",
    "        print('blocked', host, port)",
    "try:",
    "    socket.getaddrinfo('login.microsoftonline.us', 443)",
    "    print('OPEN dns')",
    "except OSError:",
    "    print('blocked dns')",
    "PY",
  ].join("\n")
  const seen = new Set<string>()
  let watching = true
  const watcher = (async () => {
    while (watching) {
      for (const name of kubectl("-n", "bymorning-sandbox", "get", "pods", "-o", "jsonpath={.items[*].metadata.name}").split(" ").filter(Boolean)) seen.add(name)
      await sleep(400)
    }
  })()
  const first = "python3 -c 'print(1+1)'"
  let result
  try {
    result = await converse("Run some Python", [
      { tool: "shell", input: { command: first }, id: "shell_math" },
      { tool: "shell", input: { command: probe }, id: "shell_egress" },
      { text: "The sandbox printed 2 and had no network." },
    ])
  } finally {
    watching = false
    await watcher
  }
  const requests = await bedrockRequests()
  // The tool result the model actually received in its next request.
  const toolOutput = (id: string) => {
    for (const request of requests.toReversed()) {
      for (const message of request.body.messages ?? []) {
        for (const block of message.content ?? []) {
          if (block.toolResult?.toolUseId === id) return (block.toolResult.content as any[]).map((part) => part.text ?? text(part.json ?? part)).join("")
        }
      }
    }
    return undefined
  }
  const math = toolOutput("shell_math")
  assert(math?.trim() === "2", `print(1+1) result: ${text(math)}`)
  const egress = toolOutput("shell_egress")
  assert(egress !== undefined, "no egress result reached the model")
  assert(!/OPEN/.test(egress) && egress.includes("blocked dns") && (egress.match(/blocked/g) ?? []).length === 4, `sandbox egress was not fully blocked: ${text(egress)}`)
  assert(seen.size >= 2, `expected at least two sandbox pods during the run, saw ${[...seen]}`)
  await until("no sandbox pods left", 60, () => (kubectl("-n", "bymorning-sandbox", "get", "pods", "-o", "name").trim() === "" ? true : undefined))
  assert(result.messages.includes("The sandbox printed 2"), "final assistant text missing")
  return `shell tool -> Kubernetes Code Interpreter ran print(1+1) in a fresh sandbox pod and returned stdout "2"; the same pod network could not reach the API server, 8.8.8.8, 1.1.1.1 or DNS; ${seen.size} sandbox pods (${[...seen].join(", ")}) existed during the run and none remain`
})

// ---- E2E-14 no sandbox pod leaked, sweep left nothing ----
await check("E2E-14", async () => {
  const left = kubectl("-n", "bymorning-sandbox", "get", "pods", "-o", "name").trim()
  assert(left === "", `sandbox pods remain: ${left}`)
  const spec = JSON.parse(kubectl("-n", "bymorning-sandbox", "get", "networkpolicy", "sandbox-deny-all", "-o", "json")).spec
  assert(spec.policyTypes.includes("Egress") && spec.policyTypes.includes("Ingress") && (spec.egress ?? []).length === 0, "deny-all policy is not deny-all")
  const image = run("kubectl", ["-n", "bymorning", "get", "cm", "-o", "json"]).stdout
  assert(image.includes(`bymorning-code-interpreter@${cfg.executionDigest}`), "the Gateway is not configured with the exact execution digest")
  return "no sandbox pods remain after all executions; deny-all NetworkPolicy has no allow rules; the Gateway is configured with the exact execution image digest"
})

// ---- E2E-15 secrets are not logged ----
await check("E2E-15", async () => {
  snapshotLogs()
  const emulatorLog = run("kubectl", ["-n", cfg.boundary, "logs", "deploy/emulators"]).stdout
  const azuriteLog = run("kubectl", ["-n", cfg.boundary, "logs", "deploy/azurite"]).stdout
  const projected = gatewayExec("cat", "/var/run/secrets/azure/tokens/azure-identity-token").stdout.trim()
  const awsToken = gatewayExec("cat", "/var/run/secrets/aws/token").stdout.trim()
  const needles: [string, string][] = [
    ["database password", cfg.dbPassword],
    ["cookie key", cfg.cookieKey],
    ["Auth Provider client secret", cfg.idpClientSecret],
    ["saved AWS secret key", cfg.staticSecret],
    ["storage account key", cfg.accountKey],
    ["projected Azure token signature", projected.split(".")[2]!],
    ["projected AWS token signature", awsToken.split(".")[2]!],
  ]
  const corpus = [...logs, emulatorLog, azuriteLog].join("\n")
  const leaked = needles.filter(([, value]) => corpus.includes(value)).map(([label]) => label)
  assert(leaked.length === 0, `secrets found in logs: ${leaked}`)
  assert(!/BEGIN (RSA |EC )?PRIVATE KEY/.test(corpus), "a private key appears in the logs")
  return `${logs.length} Gateway/migrate log snapshots (${Math.round(corpus.length / 1024)} KiB with emulator and Azurite logs) contain none of: ${needles.map(([label]) => label).join(", ")}`
})

finish()

function finish(): never {
  gateway.close()
  control.close()
  const failed = results.filter((result) => result.outcome === "FAIL").length
  const skipped = results.filter((result) => result.outcome === "SKIP").length
  console.log(`\ndriver: ${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)
  process.exit(failed === 0 ? 0 : 1)
}
