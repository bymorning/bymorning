# ByMorning Helm chart

Runs ByMorning on a Kubernetes cluster you operate: one Gateway pod, with its database migrations in an init container.
ByMorning is open source and community maintained; read [SECURITY.md](../../SECURITY.md) first.

The chart installs the same hardened image as every other installer. It does not create a database, object storage, or
a key: you point it at yours (PostgreSQL 17, S3 or Azure Blob, and KMS or Key Vault).

```text
Ingress ─► Service ─► Deployment: 1 pod, Recreate
                        ├─ migrate  (init container; applies migrations, exits)
                        └─ gateway  (UI + API on :3210)
gateway ─► your PostgreSQL 17, object storage, and key service
```

Every container runs as uid 65532 with a read-only root filesystem, no privilege escalation, all capabilities dropped,
and the runtime default seccomp profile. The image is pinned by digest, and the chart refuses to render without one.

## Install

The chart is published to `oci://ghcr.io/bymorning/charts/bymorning` with every release from 1.3.3, signed like the
images; its version is the release version, and it runs that release's image. A checkout of this repository works too
(`helm install bymorning ./charts/bymorning`). Verify the image first, and use its digest (see
[the download page](https://bymorning.ai/download)):

```sh
version=<version>
digest=$(crane digest ghcr.io/bymorning/bymorning:$version)
cosign verify ghcr.io/bymorning/bymorning:$version \
  --certificate-identity https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v$version \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Then verify the chart the same way, before you install it:

```sh
cosign verify ghcr.io/bymorning/charts/bymorning:$version \
  --certificate-identity https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v$version \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### A cloud installation

Create the Secret first: `DATABASE_URL`, `WEB_COOKIE_KEY` (32 base64url bytes), and any of `DATABASE_CA`, `SETUP_TOKEN`,
or provider secrets. Then install with values like these for AWS (EKS with IAM roles for service accounts):

```yaml
# values.yaml
image:
  digest: sha256:<digest>
appOrigin: https://bymorning.example.com
existingSecret: bymorning-secrets
config:
  STORAGE_PROVIDER: s3
  STORAGE_BUCKET: my-bymorning-storage
  CIPHER_BACKEND: kms
  CREDENTIAL_KMS_KEY: arn:aws:kms:us-east-1:123456789012:key/<key id>
  AWS_REGION: us-east-1
  AWS_USE_FIPS_ENDPOINT: "true"
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/bymorning
trustedProxies: 10.0.0.0/8 # the ingress controller's addresses
ingress:
  enabled: true
  className: nginx
  host: bymorning.example.com
  tlsSecretName: bymorning-tls
```

```sh
helm install bymorning oci://ghcr.io/bymorning/charts/bymorning --version $version -f values.yaml
```

For Azure (AKS with workload identity), set `STORAGE_PROVIDER: azure-blob`, `STORAGE_ACCOUNT_URL`,
`STORAGE_CONTAINER`, `CIPHER_BACKEND: keyvault`, `KEY_VAULT_KEY`, and `AZURE_CLOUD`, and give the service account the
`azure.workload.identity/client-id` annotation and the pod the `azure.workload.identity/use: "true"` label
(`podLabels`). [Environment reference](https://bymorning.ai/docs/deploy/environment) lists every variable and rule.

The IAM role or managed identity, the bucket or storage account, the key, and the database are yours to create. The
[AWS](../../installers/aws) and [Azure](../../installers/azure) installers show what each needs. Then open the origin and
follow [First sign-in](https://bymorning.ai/docs/deploy/first-run). The Setup token is written inside the pod; read it
with `kubectl exec deploy/bymorning -- cat /tmp/bymorning/setup-token`, or set `SETUP_TOKEN` in the Secret.

### An evaluation installation

`evaluation.enabled=true` sets `BYMORNING_EVALUATION=true`: filesystem storage on a PersistentVolumeClaim, a local key
from `CIPHER_KEY` in the Secret, and Local Login on a loopback `appOrigin` (`http://localhost:3210`), reached with
`kubectl port-forward svc/bymorning 3210:80`. It needs a PostgreSQL you provide. It is **not for production**: the key
is an exportable secret, files are not encrypted, anyone who can reach the port is signed in, and it cannot become a
production installation. See [the host guide](../../app/host/README.md#evaluation-installations).

## Values

| Value                                    | Default                      | Meaning                                                                             |
| ---------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `image.digest`                           | required                     | `sha256:<64 hex>`. The chart refuses a tag.                                         |
| `appOrigin`                              | required                     | Public origin, https (http://localhost only for evaluation).                        |
| `config`                                 | `{}`                         | Non-secret environment: backends and their companions.                              |
| `existingSecret`                         | `""`                         | A Secret you manage. Prefer it to `secrets`.                                        |
| `secrets`                                | `{}`                         | Convenience: the chart creates a Secret from these. They end up in the release.     |
| `installationDocument`                   | `/app/bymorning.azure.jsonc` | One of the image's documents. `.cui.jsonc` is the CUI profile.                      |
| `installationConfig`                     | `""`                         | Your own installation document, mounted at `/config/bymorning.jsonc`.               |
| `tls.enabled`, `tls.secretName`          | `false`, `""`                | Listener TLS from a `tls.crt`/`tls.key` Secret; probes and ingress switch to HTTPS. |
| `trustedProxies`                         | `""`                         | Ingress controller addresses trusted for `X-Forwarded-For`.                         |
| `evaluation.enabled`                     | `false`                      | An evaluation installation (see above).                                             |
| `serviceAccount.annotations`             | `{}`                         | IRSA or workload identity.                                                          |
| `ingress.*`                              | disabled                     | `enabled`, `className`, `annotations`, `host`, `tlsSecretName`.                     |
| `resources.gateway`, `resources.migrate` | see `values.yaml`            | The migrator needs headroom: it loads the whole bundle.                             |

There is deliberately no replica setting: OAuth callback state and the scheduler are process-local, so the pod uses the
`Recreate` strategy and an upgrade causes a short interruption.

## Upgrade and remove

Snapshot the database, verify the new image, then `helm upgrade` with the new digest. Migrations only move forward, so
to go back after a release that added migrations, restore the snapshot first. `helm uninstall` removes what the chart
created, including an evaluation data volume; your database, bucket, and key stay.

## Tests

`sh charts/bymorning/test.sh` runs lint, renders, schema and pod-policy checks, and the guards offline.
`KIND_INTEGRATION=1 RELEASE_DIR=<release> sh charts/bymorning/test/kind.sh` installs the signed release image into a kind
cluster (needs Docker, kind, kubectl, helm, and cosign). Neither proves a cloud's IAM, network, or storage behavior: run
your own checks in your account.
