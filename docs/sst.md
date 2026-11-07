# Deploying with SST

The repository contains an SST app (`sst.config.ts` and `infra/`). This page covers its database operations and its
authentication settings. The other installers have their own guides, linked from the [README](../README.md#install):
the Terraform modules for AWS and Azure, the Helm chart, and the Docker Compose evaluation.

## Database migrations

Run all database operations from `packages/core`, so Drizzle uses the Core configuration. `sst shell` supplies the
selected stage's linked `Database` resource:

```bash
cd packages/core

bunx sst shell --stage <stage> -- bun db generate --name <migration_name>
bunx sst shell --stage <stage> -- bun db migrate
bunx sst shell --stage <stage> -- bun db studio
bunx sst shell --stage <stage> -- bun db:check
```

- Generate a migration after changing the Core schema, then inspect the generated SQL and snapshot before applying it.
- Never edit, replace, or delete a migration that has been applied to any stage. Make follow-up changes with a new
  forward migration instead.
- Apply migrations before deploying code that depends on them. SST deployments run the migration Lambda before updating
  the Server and stop the deployment when the migration fails.

PostgreSQL migrations are forward-only and live in `packages/core/src/database/migration/`. The current development
baseline is a destructive clean break: databases created from the previous migration history must be reset.

## Authentication

Each deployed stage needs a cookie key in SST. The repository provides no secret defaults:

```bash
bunx sst secret set WEB_COOKIE_KEY --stage <stage>
```

`WEB_COOKIE_KEY` must be a 32-byte base64url value.

### Single sign-on

The deployment-time OIDC settings (`AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_PROVIDER`, and
`AUTH_EMAIL_DOMAINS`) are retired. Configure SSO at runtime instead:

1. Deploy, then open Setup.
2. Present the installation setup token. It is never logged. At startup it is written owner-read-only to the server's
   setup-token file (`<data directory>/setup-token` for the development host, `/tmp/bymorning/setup-token` in the
   image), or the operator supplies it as the `SETUP_TOKEN` secret.
3. Register with your identity provider the callback URL that Setup shows.
4. Enter the issuer, client ID, client secret, and admitted email domains.

Replace the connection later through Settings → Security (Auth Provider).

Any OIDC-compliant identity provider with the authorization-code grant works. Each Auth Provider has its own redirect
URI, `${APP_ORIGIN}/auth/callback/<providerID>`, which Setup shows before you save. Enter the provider connection once
in Setup; later changes go through Settings → Security (Auth Provider). For provider-specific steps, see the
[identity provider setup guide](guides/identity-provider-setup.md).

### Application origin

- **Commercial SST stages:** the shared Router URL is the trusted application origin. It serves the static frontend
  and forwards `/auth`, `/api`, and `/system` to the Server.
- **Terraform installations:** the Gateway serves the embedded UI, and the Gateway is the HTTPS origin.
- **Local development:** the configured `APP_ORIGIN` is the origin. Vite forwards the same route families to the local
  API, and `bun dev` configures the local login provider and the persisted cookie key automatically.

### Integration OAuth callbacks

Integration OAuth callbacks use a process-local, one-use rendezvous. `max: 1` prevents steady-state routing across
multiple tasks, but it does not preserve pending flows across a restart or rolling replacement: every deployment or
restart invalidates pending Integration OAuth attempts, and affected users must retry. Operations should drain active
requests and avoid old/new task overlap. Increasing the replica count requires shared callback storage.
