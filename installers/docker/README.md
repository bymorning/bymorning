# Evaluate ByMorning with Docker Compose

This runs the real release image on one machine with PostgreSQL, so you can try ByMorning without a cloud account or
an identity provider. It is an **evaluation installation**: it is not for production and cannot become one. Read
[What it gives up](#what-it-gives-up) before you put anything real in it.

You need Docker with Compose and OpenSSL. The image is linux/amd64, so Apple silicon runs it under emulation, which
is slower.

## Start it

Release images are published to `ghcr.io/bymorning/bymorning` from the first release after 1.3.1. In an empty folder,
download [`compose.yml`](compose.yml) and write `.env` beside it, replacing `<version>` with the release you want:

```sh
key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '='; }
cat > .env <<EOF
BYMORNING_IMAGE=ghcr.io/bymorning/bymorning:<version>
CIPHER_KEY=$(key)
WEB_COOKIE_KEY=$(key)
EOF
chmod 600 .env
docker compose up -d
```

Open <http://localhost:3210>. Local Login signs you in as `evaluator@local.test`. To use a model, add a Provider and
its API key under **Gateway → Models**.

`CIPHER_KEY` protects every secret ByMorning stores, such as the API keys and OAuth tokens you add. Keep `.env`: if
you lose it, the stored secrets cannot be read again.

## Verify the image

Each release image is signed keylessly by the release workflow, with its SBOM attached; the Gateway also carries its SLSA provenance. With
[cosign](https://docs.sigstore.dev/cosign/system_config/installation/):

```sh
image=ghcr.io/bymorning/bymorning:<version>
identity=https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v<version>
cosign verify "$image" --certificate-identity "$identity" --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation "$image" --type slsaprovenance1 --certificate-identity "$identity" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com > /dev/null
```

For the strongest pin, put the verified digest in `.env` instead of the tag: `ghcr.io/bymorning/bymorning@sha256:…`.

## Stop or remove it

```sh
docker compose down      # stop; data stays in the volumes
docker compose down -v   # stop and delete the database and stored files
```

## What it gives up

The compose file sets `BYMORNING_EVALUATION=true`, which lets the image use local disk, a local key, and Local Login.
Compared with a production installation:

- **Secrets** are protected only by `CIPHER_KEY`. Anyone who can read `.env` or the container's environment can decrypt
  every stored credential. Key use isn't logged, and there is no revocation or rotation. A production installation
  uses AWS KMS or Azure Key Vault.
- **Files** you upload, and Tool output, are stored unencrypted in the `data` volume, with no backup.
- **Sign-in** needs no password: anyone who can reach port 3210 is signed in as the evaluator. The port is published on
  `127.0.0.1` only. Don't change that.
- **No path to production.** A production installation uses different storage and keys, so it starts empty. Install
  it with an installer for your cloud: see the [deployment docs](https://bymorning.ai/docs/deploy).

The full contract is in [app/host/README.md](../../app/host/README.md#evaluation-installations).
