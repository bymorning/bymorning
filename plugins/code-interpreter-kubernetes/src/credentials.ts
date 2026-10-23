import { readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"

/** How to reach and authenticate to one Kubernetes API server. Token files are re-read per request (they rotate). */
export interface Credentials {
  readonly server: URL
  readonly ca: string | Buffer | undefined
  readonly cert: string | Buffer | undefined
  readonly key: string | Buffer | undefined
  readonly insecure: boolean
  readonly token: () => string | undefined
}

export const serviceAccountDirectory = "/var/run/secrets/kubernetes.io/serviceaccount"

/** The pod's own service account: KUBERNETES_SERVICE_HOST/PORT, the projected token and the cluster CA. */
export const inCluster = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  directory = serviceAccountDirectory,
): Credentials => {
  const host = environment.KUBERNETES_SERVICE_HOST
  if (host === undefined || host === "")
    throw new Error(
      "Not running in a Kubernetes pod: KUBERNETES_SERVICE_HOST is unset (configure kubeconfig for local use)",
    )
  const port = environment.KUBERNETES_SERVICE_PORT || "443"
  const tokenFile = path.join(directory, "token")
  // Fail at activation, not on the first execution, when the service account token is not mounted.
  readFileSync(tokenFile)
  return {
    server: new URL(`https://${host.includes(":") ? `[${host}]` : host}:${port}`),
    ca: readFileSync(path.join(directory, "ca.crt")),
    cert: undefined,
    key: undefined,
    insecure: false,
    token: () => readFileSync(tokenFile, "utf8").trim(),
  }
}

interface Named<A> {
  readonly name: string
  readonly [key: string]: unknown
  readonly cluster?: A
  readonly user?: A
  readonly context?: A
}
type Record_ = Readonly<Record<string, unknown>>
const record = (value: unknown, what: string): Record_ => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Invalid kubeconfig: ${what}`)
  return value as Record_
}
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)
const find = (entries: unknown, name: string, kind: string, key: "cluster" | "user" | "context") => {
  const found = (Array.isArray(entries) ? (entries as ReadonlyArray<Named<unknown>>) : []).find(
    (entry) => entry?.name === name,
  )
  if (found === undefined) throw new Error(`Invalid kubeconfig: ${kind} ${name} not found`)
  return record(found[key], `${kind} ${name}`)
}

/**
 * Minimal kubeconfig reader for local testing: server, CA, bearer token or client certificate. Credential plugins
 * (`exec`, `auth-provider`) are not supported and refuse loudly rather than run a command.
 */
export const fromKubeconfig = (file: string, contextName?: string): Credentials => {
  const document = record(parse(readFileSync(file, "utf8")), "not a mapping")
  const directory = path.dirname(file)
  const selected = contextName ?? text(document["current-context"])
  if (selected === undefined) throw new Error("Invalid kubeconfig: no current-context; set kubeContext")
  const context = find(document.contexts, selected, "context", "context")
  const cluster = find(document.clusters, String(context.cluster), "cluster", "cluster")
  const user = find(document.users, String(context.user), "user", "user")
  if (user.exec !== undefined || user["auth-provider"] !== undefined)
    throw new Error(
      "Unsupported kubeconfig user: credential plugins are not supported; use a token or client certificate",
    )
  const data = (inline: string, filename: string) => {
    const encoded = text(cluster[inline] ?? user[inline])
    if (encoded !== undefined) return Buffer.from(encoded, "base64")
    const source = text(cluster[filename] ?? user[filename])
    return source === undefined ? undefined : readFileSync(path.resolve(directory, source))
  }
  const server = text(cluster.server)
  if (server === undefined) throw new Error("Invalid kubeconfig: cluster has no server")
  const token = text(user.token)
  const tokenFile = text(user.tokenFile)
  return {
    server: new URL(server),
    ca: data("certificate-authority-data", "certificate-authority"),
    cert: data("client-certificate-data", "client-certificate"),
    key: data("client-key-data", "client-key"),
    insecure: cluster["insecure-skip-tls-verify"] === true,
    token: () =>
      token ?? (tokenFile === undefined ? undefined : readFileSync(path.resolve(directory, tokenFile), "utf8").trim()),
  }
}
