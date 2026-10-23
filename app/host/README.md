# ByMorning host

`@bymorning/host` is the one host program behind the one Gateway image. The image is bound to a cloud at
startup by environment variables the installer sets; nothing about the cloud is baked into the image. Both cloud
backends (S3 and KMS; Blob Storage and Key Vault) and both production Code Interpreter plugins (AgentCore,
Kubernetes) ship in every image. `src/host.ts` (`Host.resolve`) reads the environment, selects the implementations,
enforces the rules below, and hands the result to `Application.serve`.

## The deployer's contract

### Set by your installer

The AWS task definition or the Azure manifests (AKS) set these; you do not normally edit them.

| Variable                                                                                          | AWS (ECS)                                                          | Azure (AKS)                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `STORAGE_PROVIDER`                                                                                | `s3`                                                               | `azure-blob`                                              |
| `CIPHER_BACKEND`                                                                                  | `kms`                                                              | `keyvault`                                                |
| Storage companions                                                                                | `STORAGE_BUCKET`, `AWS_REGION`                                     | `STORAGE_ACCOUNT_URL`, `STORAGE_CONTAINER`, `AZURE_CLOUD` |
| Cipher companions                                                                                 | `CREDENTIAL_KMS_KEY`, `AWS_REGION`                                 | `KEY_VAULT_KEY`, `AZURE_CLOUD`                            |
| `DATABASE_URL`                                                                                    | `sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` | plain URL, trust from `DATABASE_CA`                       |
| `DATABASE_CA`                                                                                     | not used                                                           | PEM of the PostgreSQL root CAs                            |
| `AWS_USE_FIPS_ENDPOINT`                                                                           | `true`                                                             | only for Bedrock in a GovCloud partition                  |
| `APP_ORIGIN`, `PORT`, `WEB_COOKIE_KEY`, `TRUSTED_PROXIES`, `TLS_CERT`/`TLS_KEY` (both or neither) | as today                                                           | as today                                                  |
| `BYMORNING_CONFIG`                                                                                | `/app/bymorning.cui.jsonc` or `/app/bymorning.jsonc`               | `/config/bymorning.jsonc` from the ConfigMap              |

`/app/certs/rds-global-bundle.pem` is the AWS commercial global RDS CA bundle (114 certificates) followed by the AWS
GovCloud global bundle (10 certificates, covering `us-gov-west-1` and `us-gov-east-1`), each pinned by sha256 in the root
`Dockerfile`. Neither partition's bundle verifies the other's Aurora endpoints, so the one path serves both.

`AWS_REGION` means "Region of the storage bucket and KMS key" on AWS and "Bedrock Region" on Azure. `AZURE_CLOUD` is
`AzureCloud` or `AzureUSGovernment`. The selectors may be mixed (for example `s3` with `keyvault`); each selection
reads only its own companions.

The image ships three installation documents beside the bundle: `bymorning.jsonc` (Google, Share, AgentCore),
`bymorning.cui.jsonc` (AgentCore only; no Share public links, no Google plugin), and `bymorning.azure.jsonc` (Google,
Atlassian, Share; no Code Interpreter). The Kubernetes Code Interpreter document is deployment-specific because of its
digest-pinned `image`; the Azure installer's ConfigMap component carries the example.

### You may add

`SETUP_TOKEN`, `LOGIN_BANNER`, `SESSION_IDLE_TIMEOUT`, `SESSION_ABSOLUTE_TIMEOUT`, `AUTH_*` (seed one Auth Provider:
`AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_PROVIDER`, `AUTH_EMAIL_DOMAINS`; all five or none), and any
variable your installation document references through `{ "env": "NAME" }` (`CODE_INTERPRETER_ID` for AgentCore;
`AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_BEARER_TOKEN_BEDROCK` for Bedrock from Azure).

### Image-owned; do not override

`HOST=0.0.0.0`, `OPENSSL_CONF`, `HOME`, `BYMORNING_VERSION`.

### Rules the host enforces at startup

Each refusal exits non-zero and is logged once as one line (`Startup failed`) through the configured logger. A rule
violation is a `Host.ConfigError` naming the variable and the rule; no value is echoed. A missing or malformed
_companion_ variable (`STORAGE_BUCKET`, `KEY_VAULT_KEY`, `DATABASE_URL`, `WEB_COOKIE_KEY`, `PORT`, …) surfaces as an
Effect `ConfigError` naming the variable instead.

- A selector is missing or has an unknown value (the message lists the offered values, not the value given), or a
  companion it needs is missing.
- `AZURE_CLOUD` is required (no default) when either selector is `azure-*`; `STORAGE_ACCOUNT_URL` and `KEY_VAULT_KEY`
  must be bare `https:` endpoints of that cloud (no credentials, port, path, query, or fragment).
- `AUTH_ISSUER` must be a bare `https:` URL. A Microsoft issuer must be a tenant `v2.0` issuer of the `AZURE_CLOUD`
  authority; when `AZURE_CLOUD` is unset (an AWS deployment) either Microsoft authority is accepted.
- `CREDENTIAL_KMS_KEY` is a full KMS key ARN (`arn:<partition>:kms:<region>:<account>:key/<key-id>`; not an alias,
  not a bare key id) whose Region equals `AWS_REGION` and whose partition is `aws-us-gov` exactly when the Region is
  `us-gov-*`.
- `AWS_USE_FIPS_ENDPOINT`, when set, is exactly `true` or `false` (the AWS SDK accepts nothing else). Whenever
  `AWS_REGION` is `us-gov-*` — on any selection, including Azure deployments reaching Bedrock in GovCloud — it must be
  `true`.
- A `kubernetes` Code Interpreter is selected with an `image` that is not pinned by digest: refuse.
- `APP_ORIGIN` must be an `https:` origin with no path, query, or fragment. The image never serves a plain-HTTP origin,
  loopback included; only the development entry accepts `http://localhost`, `http://127.0.0.1`, and `http://[::1]`.
- `PORT` is 1–65535 (default 3210).
- `TLS_CERT` and `TLS_KEY` are set together or not at all.
- `BYMORNING_DATA_DIR` is ignored in production: the Plugin cache lives under the system temporary directory.

After the rules pass the host logs one `Host resolved` line naming the storage provider, the key identity (the KMS ARN,
the versioned Key Vault URL, or `local`), `AZURE_CLOUD`, `AWS_REGION`, and the FIPS flag.

`AWS_USE_FIPS_ENDPOINT=true` routes S3, KMS, and Bedrock Converse to FIPS-designated endpoints; Bedrock Mantle has no
FIPS endpoint and keeps its standard hostname, announced once at startup.

### `migrate`

```sh
node /app/bymorning.mjs migrate
```

`migrate` reads only `DATABASE_URL` and `DATABASE_CA`. It does not load either cloud backend or construct a cloud
client; it applies the migrations embedded in the bundle under an advisory lock, exits `0`, and exits `1` with an
opaque `Host.MigrationError` on failure. The log names only the error class — the PostgreSQL SQLSTATE (`28P01` for a
rejected password), the Node error code (`ECONNREFUSED`, `ENOTFOUND`, `SELF_SIGNED_CERT_IN_CHAIN`, …), or the missing
variable — never the URL, host, user, password, or SQL. An ECS `migrate` container relies on this
(`ecs.tf` passes it only `DATABASE_URL`); on AKS run it as an init container or Job before each rollout. The serving
process never migrates.

### Selectors are fixed for the life of an installation

Every credential envelope names the key that wrapped it, and the selected key backend refuses an envelope written by
any other key before calling the cloud (the `Cipher` key identity: the KMS ARN or the versioned Key Vault URL). So
changing `CIPHER_BACKEND`, or pointing it at a different key, makes every stored Credential unreadable (503) rather
than silently wrong. Storage keys carry no such identity: nothing checks that `STORAGE_PROVIDER` still names the
provider that wrote them, and changing it on existing data orphans every stored object.

## Development

The development entry (`src/dev.ts`) runs the same `Host.resolve` with what never enters the image: PGlite when
`DATABASE_URL` is absent, `STORAGE_PROVIDER=filesystem`, `CIPHER_BACKEND=local`, Local
Login, and the Docker Code Interpreter document (`bymorning.docker.jsonc`). Environment variables are the one surface;
defaults make a loopback deployment under `<repository>/.bymorning/local` (PGlite, filesystem storage, the generated
cookie and cipher keys, the setup token, and the Plugin cache). From the repository root:

```sh
bun run --cwd app/host setup   # execution image for the Docker Code Interpreter (optional)
bun run dev                    # tsx watch src/dev.ts on 127.0.0.1:3210 plus Vite on localhost:3000
bun run local                  # development bundle serving UI and API from one origin (PORT, default 3210)
```

`PORT` selects the API port and `WEB_PORT` the Vite port for `bun run dev`; the API's `APP_ORIGIN` defaults to
`http://localhost:$WEB_PORT` there and to `http://localhost:$PORT` for `bun run local`. Vite uses `--strictPort`.
Give every simultaneous instance a distinct port pair, `BYMORNING_DATA_DIR`, and browser context; cookies are scoped
by hostname, not port. `DATABASE_URL` (with `DATABASE_CA` for TLS) selects an existing PostgreSQL server instead of
PGlite; `CIPHER_KEY` supplies the local cipher master key instead of the generated `cipher.key`. On loopback origins
Local Login signs in `developer@local.test`; any other `APP_ORIGIN` refuses Local Login, switches to Secure cookies,
and signs in through a seeded (`AUTH_*`) or Setup-registered Auth Provider. `BYMORNING_CONFIG` selects another
installation document; `bymorning.docker.jsonc` names the execution image in `plugins[].options.image`.

`bun run --cwd app/host build` produces the production bundle the root `Dockerfile` ships (seven plugins, three
documents, no PGlite); `build:dev` adds the Docker plugin, the development document, and the PGlite runtime files.
Both write `dist/`; distribute the complete directory and run `node dist/bymorning.mjs` with Node 22+.

## Image checks

`packages/server/test/image-smoke.sh` builds the image, checks the exports, and runs `migrate` against a throwaway
PostgreSQL container. `image-security.sh` asserts the FIPS, user, toolchain, label, and trust-anchor properties.
`image-boot.sh` (`bun run test:boot` in `packages/server`) boots the linux/amd64 image with the AWS selection the way
an AWS ECS task runs it: verify-full database TLS, the HTTPS listener, KMS and S3 through the FIPS hostnames
(emulated), the plugin and document inventory, and the startup refusals above. `LEG=azure` boots it the way the AKS
pod runs it instead: plain-HTTP health, the workload-identity token exchange and Key Vault (emulated at the production
hostnames), Blob Storage against Azurite, inventory, log hygiene, and the cloud-endpoint refusals. Both scripts take
`TARBALL=` (with `RELEASE_DIR=`) to test the exact release artifact after verifying it against the manifest. The
emulators prove no IAM, Azure RBAC, network, or deployment behavior, and AgentCore is not exercised.
