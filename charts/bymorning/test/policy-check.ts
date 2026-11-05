// Asserts pod-security and secret-handling rules on the chart's rendered manifests, read from stdin:
//   helm template x charts/bymorning -f charts/bymorning/ci/production-values.yaml | bun charts/bymorning/test/policy-check.ts
// Pass --evaluation for an evaluation render.
type Json = Record<string, any>

const evaluation = process.argv.includes("--evaluation")
const documents = (await Bun.stdin.text())
  .split(/^---$/m)
  .filter((part) => part.trim() !== "")
  .map((part) => Bun.YAML.parse(part) as Json)
  .filter((doc) => doc?.kind)
const errors: string[] = []
const fail = (message: string) => errors.push(message)

const deployments = documents.filter((doc) => doc.kind === "Deployment")
if (deployments.length !== 1) fail(`expected exactly one Deployment, found ${deployments.length}`)

for (const deployment of deployments) {
  const spec = deployment.spec
  const pod = spec.template.spec
  if (spec.replicas !== 1) fail("replicas must be 1")
  if (spec.strategy?.type !== "Recreate") fail("strategy must be Recreate")
  if (pod.hostNetwork || pod.hostPID || pod.hostIPC) fail("host namespaces are forbidden")
  if (pod.securityContext?.runAsNonRoot !== true) fail("pod runAsNonRoot must be true")
  if (pod.securityContext?.runAsUser !== 65532) fail("pod must run as uid 65532, the image's user")
  if (pod.securityContext?.seccompProfile?.type !== "RuntimeDefault") fail("pod seccompProfile must be RuntimeDefault")
  if (pod.automountServiceAccountToken !== false) fail("the service account token must not be mounted")
  if (!pod.serviceAccountName || pod.serviceAccountName === "default") fail("needs a dedicated service account")
  const init = pod.initContainers ?? []
  if (init.length !== 1 || init[0].name !== "migrate") fail("expected one migrate init container")
  if (JSON.stringify(init[0]?.command) !== JSON.stringify(["node", "/app/bymorning.mjs", "migrate"])) fail("migrate runs the wrong command")
  if (pod.containers[0]?.name !== "gateway") fail("the gateway container must come first")
  for (const container of [...init, ...pod.containers]) {
    const where = container.name
    if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(container.image)) fail(`${where}: image must be pinned by digest`)
    const security = container.securityContext ?? {}
    if (security.allowPrivilegeEscalation !== false) fail(`${where}: allowPrivilegeEscalation must be false`)
    if (security.readOnlyRootFilesystem !== true) fail(`${where}: readOnlyRootFilesystem must be true`)
    if (security.runAsNonRoot !== true) fail(`${where}: runAsNonRoot must be true`)
    if (JSON.stringify(security.capabilities?.drop) !== JSON.stringify(["ALL"])) fail(`${where}: must drop ALL capabilities`)
    if (security.privileged) fail(`${where}: privileged is forbidden`)
    if (!container.resources?.requests?.memory || !container.resources?.limits?.memory) fail(`${where}: needs memory requests and limits`)
  }
}

// Secrets never go in the ConfigMap; evaluation settings appear only in an evaluation render.
const secretNames = ["DATABASE_URL", "WEB_COOKIE_KEY", "CIPHER_KEY", "DATABASE_CA", "TLS_KEY", "SETUP_TOKEN", "AUTH_CLIENT_SECRET", "AWS_BEARER_TOKEN_BEDROCK"]
for (const map of documents.filter((doc) => doc.kind === "ConfigMap" && doc.data?.APP_ORIGIN)) {
  for (const name of secretNames) if (name in map.data) fail(`ConfigMap ${map.metadata.name} must not carry ${name}`)
  const marked = map.data.BYMORNING_EVALUATION === "true"
  if (marked !== evaluation) fail(evaluation ? "evaluation render lacks BYMORNING_EVALUATION" : "BYMORNING_EVALUATION appears outside evaluation")
  if (!evaluation && (map.data.STORAGE_PROVIDER === "filesystem" || map.data.CIPHER_BACKEND === "local")) fail("a production render offers local storage or key")
}
if (!evaluation && documents.some((doc) => doc.kind === "PersistentVolumeClaim")) fail("a production render must not create a data volume")

if (errors.length > 0) {
  console.error(errors.map((message) => `- ${message}`).join("\n"))
  process.exit(1)
}
console.log(`chart policy: ${documents.length} objects ok${evaluation ? " (evaluation)" : ""}`)
