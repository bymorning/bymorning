---
title: External Services and Network Egress
---

# External Services and Network Egress

Required egress is the cloud service endpoints in the deployment Region, the
customer's identity provider, and the in-network PostgreSQL endpoint. Nothing
else is required. The image contains no telemetry, analytics, crash
reporting, or update check, and makes no call to ByMorning or GitHub. Each
destination below is classified as Required (the deployment does not function
without it), Optional (used only if an administrator configures it), or
Restricted (Optional, and not to be enabled for CUI workloads unless the
customer explicitly authorizes the destination for CUI).

## 9.1 No telemetry, no call-home

No analytics, crash reporting, or usage beacon exists in the code. OTLP export is off unless the customer sets
`OTEL_EXPORTER_OTLP_ENDPOINT`, which should then point at a collector inside
the boundary. Provider and Model definitions ship inside the bundle, so
nothing is fetched from a model registry at runtime. The production image
disables plugin package installation and plugin update checks, so it never
contacts a package registry.

The image is pulled by the container runtime, not by the application. The
ECS agent or the kubelet contacts `ghcr.io`, and the hosts it redirects layer
downloads to, only when the customer pulls the image from there. Mirroring
the image into ECR or another private registry removes that destination.

## 9.2 Required egress

All endpoints are TCP/443 TLS unless noted. On AWS, the task's security group
allows HTTPS to any address; the customer restricts it with a NAT firewall,
proxy, or VPC endpoints (§6.1).

With `AWS_USE_FIPS_ENDPOINT=true`, always in AWS GovCloud (US) and by default
in US commercial Regions, the AWS SDK clients use the `-fips` hostnames. Bedrock
Converse traffic, which is signed in-process, is rerouted to the FIPS
hostname. Bedrock Mantle has no FIPS endpoint and keeps its standard hostname,
announced at startup. The FIPS Bedrock Runtime hostname has its own
PrivateLink service name, `com.amazonaws.<region>.bedrock-runtime-fips`; a
`bedrock-runtime` interface endpoint's private DNS does not cover it.

| Endpoint (AWS installer) | Used by | Purpose |
| ------------------------ | ------- | ------- |
| `bedrock-runtime-fips.<region>.amazonaws.com` (`bedrock-runtime` without FIPS) | Task | Converse inference for Bedrock Models |
| `bedrock-mantle.<region>.api.aws` | Task | Mantle inference, for Models the catalog serves through Mantle |
| `bedrock-agentcore-fips.<region>.amazonaws.com` (`bedrock-agentcore` without FIPS) | Task | Code Interpreter session start, invoke, get, and stop, when `code_interpreter` is on |
| `s3-fips.<region>.amazonaws.com` and bucket hostnames | Task | Storage bucket objects |
| `kms-fips.<region>.amazonaws.com` (`kms` without FIPS) | Task | Cipher `GenerateDataKey` and `Decrypt` on the installation key |
| `secretsmanager.<region>.amazonaws.com` | ECS agent | Inject the runtime secret at task start |
| `logs.<region>.amazonaws.com` | ECS agent | Container log delivery |
| `api.ecr.<region>.amazonaws.com`, `<account>.dkr.ecr.<region>.amazonaws.com`, and S3 | ECS agent | Image pull from an ECR mirror |
| PostgreSQL endpoint, TCP/5432 (in-VPC) | Task | Database over TLS 1.3 |
| The customer's identity provider issuer, for example `https://login.microsoftonline.us/<tenant>/v2.0` or `https://<org>.okta.com` | Task and browser | OIDC discovery, JWKS, token, and userinfo from the task; authorization from the browser |

The task obtains its role credentials from the ECS container credentials
endpoint, not from AWS STS. ECS Exec is disabled, so the task needs no SSM
endpoints.

| Endpoint (Azure installer) | Used by | Purpose |
| -------------------------- | ------- | ------- |
| `login.microsoftonline.us` or `login.microsoftonline.com` | Pod | Workload identity token exchange for Blob and Key Vault, and Entra sign-in when Entra is the identity provider |
| Key Vault (`<vault>.vault.usgovcloudapi.net` or `<vault>.vault.azure.net`), private endpoint | Pod | Cipher wrap and unwrap |
| Blob Storage (`<account>.blob.core.usgovcloudapi.net` or `<account>.blob.core.windows.net`), private endpoint | Pod | Storage container objects |
| PostgreSQL Flexible Server, TCP/5432 (delegated subnet) | Pod | Database over TLS |
| Kubernetes API server (in cluster) | Pod | Create and remove sandbox pods, when the Kubernetes Code Interpreter is enabled |
| The image registry (the optional ACR through its private endpoint, or the customer's registry) | Kubelet | Image pull |
| `sts.<region>.amazonaws.com`, `bedrock-runtime.<region>.amazonaws.com` (`bedrock-runtime-fips` in AWS GovCloud), `bedrock-mantle.<region>.api.aws` | Pod | Only when Amazon Bedrock is configured: web identity exchange and inference |

## 9.3 Optional egress (admin-enabled)

Enabling any third-party Model Provider sends prompts, conversation context,
and Tool content to that provider; all are Restricted. The catalog includes
OpenAI (`api.openai.com`), Anthropic (`api.anthropic.com`), Google
(`generativelanguage.googleapis.com`), OpenCode Zen (`opencode.ai`), Fireworks
(`api.fireworks.ai`), Groq (`api.groq.com`), Cerebras (`api.cerebras.ai`),
DeepInfra (`api.deepinfra.com`), Together (`api.together.xyz`), Mistral
(`api.mistral.ai`), DeepSeek (`api.deepseek.com`), Baseten
(`inference.baseten.co`), OpenRouter (`openrouter.ai`), xAI (`api.x.ai`), and
administrator-defined custom Providers. The Installation Policy keeps every one
of these unusable with `providers.allow: ["amazon-bedrock"]` (§2.10, §6.2).
Routing rules and Auto models resolve only to admitted Providers, and both
configuration sections are admin-gated (SEC-AUTHZ).

The bundled plugins and web search providers ship in the image and are inert
until configured; all are Restricted.

| Capability | Endpoints |
| ---------- | --------- |
| Google plugin | `accounts.google.com`, `oauth2.googleapis.com`, `openidconnect.googleapis.com`, `gmail.googleapis.com` |
| Slack plugin | `slack.com`, `mcp.slack.com` |
| Atlassian plugin | `mcp.atlassian.com` |
| Context7 plugin | `mcp.context7.com` |
| Web search | `mcp.exa.ai`, `mcp.firecrawl.dev`, `search.parallel.ai`, `api.tavily.com` |
| Share plugin | None; serves public transcript URLs from the application's own origin |

Outbound MCP servers are Restricted. Workspace administrators may register
arbitrary MCP server URLs. Each registration is an explicit, admin-only,
persisted enablement decision, and a disabled server never connects. Treat
each registration as a new egress request requiring authorization for CUI.

The WebFetch Tool fetches any public URL a Session asks for, so it is an
egress path to arbitrary hosts. It resolves every destination and refuses
private, loopback, link-local, CGNAT, and metadata answers before connecting.
It pins the socket to the screened answers and re-screens every redirect hop
(SEC-SSRF). Outbound MCP and custom-Provider endpoints are not screened by
that guard and remain under procedural control plus network egress policy.

`OTEL_EXPORTER_OTLP_ENDPOINT` is Optional and unset by default; it is
Restricted if pointed outside the boundary.

## 9.4 Ingress and DNS

On AWS the only ingress is the load balancer (443, with 80 redirecting to
443), internal by default. Its security group admits only `allowed_cidrs`;
the task admits 3210 only from the load balancer, PostgreSQL admits 5432 only
from the task, and the Code Interpreter security group has no rules, though DNS names still resolve (§2.9). On Azure
the only ingress is the customer's ingress controller in front of the
Gateway Service. PostgreSQL has no public access and is reachable only in its
delegated subnet. Key Vault and Blob Storage accept only their private
endpoints and the Terraform runner addresses in `deployer_ip_ranges`. The Gateway resolves endpoints through the VPC or VNet
DNS.
