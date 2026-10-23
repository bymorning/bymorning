// Asserts pod-security fields on the rendered manifests read from stdin:
//   kubectl kustomize <dir> | bun installers/azure/test/policy-check.ts
type Json = Record<string, any>

const documents = (await Bun.stdin.text())
  .split(/^---$/m)
  .filter((part) => part.trim() !== "")
  .map((part) => Bun.YAML.parse(part) as Json)
const errors: string[] = []
const fail = (message: string) => errors.push(message)

const deployments = documents.filter((doc) => doc?.kind === "Deployment")
if (deployments.length !== 1) fail(`expected exactly one Deployment, found ${deployments.length}`)

for (const deployment of deployments) {
  const name = deployment.metadata.name
  const spec = deployment.spec
  const pod = spec.template.spec
  if (spec.replicas !== 1) fail(`${name}: replicas must be 1`)
  if (spec.strategy?.type !== "Recreate") fail(`${name}: strategy must be Recreate`)
  if (spec.template.metadata.labels?.["azure.workload.identity/use"] !== "true")
    fail(`${name}: pod needs label azure.workload.identity/use=true`)
  if (pod.hostNetwork || pod.hostPID || pod.hostIPC) fail(`${name}: host namespaces are forbidden`)
  if (pod.securityContext?.runAsNonRoot !== true) fail(`${name}: pod runAsNonRoot must be true`)
  if (pod.securityContext?.seccompProfile?.type !== "RuntimeDefault")
    fail(`${name}: pod seccompProfile must be RuntimeDefault`)
  if (!pod.serviceAccountName || pod.serviceAccountName === "default")
    fail(`${name}: needs a dedicated service account`)

  const containers: Json[] = [...(pod.initContainers ?? []), ...pod.containers]
  const init = (pod.initContainers ?? []).find((c: Json) => c.name === "migrate")
  if (!init) fail(`${name}: missing migrate init container`)
  else if (JSON.stringify(init.command) !== JSON.stringify(["node", "/app/bymorning.mjs", "migrate"]))
    fail(`${name}: migrate command must be node /app/bymorning.mjs migrate`)
  if (pod.containers[0]?.name !== "gateway")
    fail(`${name}: gateway must be the first container (components patch containers/0)`)

  const volumes = new Map<string, Json>((pod.volumes ?? []).map((v: Json) => [v.name, v]))
  for (const c of containers) {
    const id = `${name}/${c.name}`
    const sc = c.securityContext ?? {}
    if (sc.allowPrivilegeEscalation !== false) fail(`${id}: allowPrivilegeEscalation must be false`)
    if (sc.readOnlyRootFilesystem !== true) fail(`${id}: readOnlyRootFilesystem must be true`)
    if (sc.runAsNonRoot !== true) fail(`${id}: runAsNonRoot must be true`)
    if (sc.privileged) fail(`${id}: must not be privileged`)
    if (JSON.stringify(sc.capabilities?.drop) !== JSON.stringify(["ALL"])) fail(`${id}: must drop ALL capabilities`)
    if (sc.capabilities?.add?.length) fail(`${id}: must not add capabilities`)
    if (!c.resources?.requests?.memory || !c.resources?.limits?.memory) fail(`${id}: needs memory requests and limits`)
    if (!c.resources?.requests?.cpu) fail(`${id}: needs a cpu request`)
    const tmp = (c.volumeMounts ?? []).find((m: Json) => m.mountPath === "/tmp")
    if (!tmp) fail(`${id}: /tmp must be mounted writable`)
    else if (!volumes.get(tmp.name)?.emptyDir) fail(`${id}: /tmp must be an emptyDir`)
    if (typeof c.image !== "string" || c.image.endsWith(":latest")) fail(`${id}: image must not be :latest`)
  }
  const gateway = pod.containers[0]
  for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"])
    if (gateway[probe]?.httpGet?.path !== "/system/health") fail(`${name}/gateway: ${probe} must GET /system/health`)
  for (const [vname, v] of volumes) if (v.hostPath) fail(`${name}: volume ${vname} must not be hostPath`)
  const mounted = new Set(containers.flatMap((c) => (c.volumeMounts ?? []).map((m: Json) => m.name)))
  for (const m of mounted) if (!volumes.has(m)) fail(`${name}: volumeMount ${m} has no volume`)
  const secrets = containers.flatMap((c) =>
    (c.envFrom ?? []).flatMap((e: Json) => (e.secretRef ? [e.secretRef.name] : [])),
  )
  if (!secrets.includes("bymorning")) fail(`${name}: must load Secret bymorning`)
}

// Secret values must never be rendered into the manifests.
for (const doc of documents)
  if (doc?.kind === "Secret") fail(`rendered manifests must not contain Secret ${doc.metadata?.name}`)
const account = documents.find((doc) => doc?.kind === "ServiceAccount" && doc.metadata?.name === "bymorning-gateway")
if (!account?.metadata?.annotations?.["azure.workload.identity/client-id"])
  fail("ServiceAccount needs azure.workload.identity/client-id")
const namespace = documents.find((doc) => doc?.kind === "Namespace")
if (namespace?.metadata?.labels?.["pod-security.kubernetes.io/enforce"] !== "restricted")
  fail("Namespace must enforce Pod Security restricted")

// The single image is bound to Azure by the two selectors; it refuses to start without them.
const env = documents.find((d) => d?.kind === "ConfigMap" && d.metadata?.name?.startsWith("bymorning-env"))
if (!env) fail("ConfigMap bymorning-env missing")
for (const [key, value] of [
  ["STORAGE_PROVIDER", "azure-blob"],
  ["CIPHER_BACKEND", "keyvault"],
  ["BYMORNING_CONFIG", "/config/bymorning.jsonc"],
] as const) {
  if (env?.data?.[key] === undefined) fail(`bymorning-env missing ${key}`)
  else if (env.data[key] !== value) fail(`bymorning-env ${key} must be ${value}, found ${env.data[key]}`)
}
for (const key of ["AZURE_CLOUD", "STORAGE_ACCOUNT_URL", "STORAGE_CONTAINER", "KEY_VAULT_KEY"])
  if (!env?.data?.[key]) fail(`bymorning-env missing ${key}`)
if (!JSON.stringify(deployments[0]?.spec.template.spec.containers[0].envFrom ?? []).includes("bymorning-env"))
  fail("gateway must load bymorning-env")

// Optional components.
const gatewayEnv = JSON.stringify(deployments[0]?.spec.template.spec.containers[0].envFrom ?? [])
const volumeNames = (deployments[0]?.spec.template.spec.volumes ?? []).map((v: Json) => v.name)
if (volumeNames.includes("aws-token")) {
  const token = deployments[0].spec.template.spec.volumes.find((v: Json) => v.name === "aws-token").projected.sources[0]
    .serviceAccountToken
  if (token.audience !== "sts.amazonaws.com") fail("AWS token audience must be sts.amazonaws.com")
  if (!gatewayEnv.includes("bymorning-aws")) fail("web identity component must load bymorning-aws")
  const aws = documents.find((d) => d?.kind === "ConfigMap" && d.metadata.name.startsWith("bymorning-aws"))
  for (const key of ["AWS_ROLE_ARN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_REGION"])
    if (!aws?.data?.[key]) fail(`bymorning-aws missing ${key}`)
  if (aws?.data?.AWS_WEB_IDENTITY_TOKEN_FILE !== "/var/run/secrets/aws/token")
    fail("AWS_WEB_IDENTITY_TOKEN_FILE must match the mount")
}
// Bedrock in a GovCloud partition: the image no longer bakes the FIPS flag, so the overlay must set it.
const aws = documents.find((d) => d?.kind === "ConfigMap" && d.metadata?.name?.startsWith("bymorning-aws"))
if (aws?.data?.AWS_REGION?.startsWith("us-gov-") && aws.data.AWS_USE_FIPS_ENDPOINT !== "true")
  fail("bymorning-aws: AWS_REGION is us-gov-* but AWS_USE_FIPS_ENDPOINT is not true")
if (
  deployments[0]?.spec.template.spec.automountServiceAccountToken === true &&
  !JSON.stringify(documents).includes("plugin-code-interpreter-kubernetes")
)
  fail("service account token mounted without the Kubernetes Code Interpreter configured")

if (errors.length) {
  console.error(`policy check failed:\n- ${errors.join("\n- ")}`)
  process.exit(1)
}
console.log(`policy check ok (${deployments.length} Deployment, ${documents.length} documents)`)
