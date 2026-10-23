# Enterprise Plugin examples

Use these standalone Promise plugins to connect company systems, share
workflows, apply policies, and observe Tool activity. Each file exports one Plugin
and can be copied independently.

## Choose an example

| Example                                       | What you get                                                               | Public API                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| [Company context](src/company-context.ts)     | Company instructions and an on-demand handbook Reference.                  | `instruction.transform`, `reference.transform` |
| [Incident response](src/incident-response.ts) | An on-demand Skill for evidence-driven incident investigation and handoff. | `skill.transform`                              |
| [Release review](src/release-review.ts)       | An on-demand Skill for reviewing release readiness and rollback plans.     | `skill.transform`                              |
| [Service catalog](src/service-catalog.ts)     | An administrator-configured internal MCP endpoint.                         | `mcp.transform`, `configuration`               |
| [Service lookup](src/service-lookup.ts)       | An authenticated REST Tool for finding service ownership and runbooks.     | `integration.transform`, `tool.transform`      |
| [Company policy](src/company-policy.ts)       | Restricted-Provider denial and Gateway customer-ID redaction.              | `session.hook`, `gateway.hook`                 |
| [Redaction](src/redaction.ts)                 | SSN, email, and secret-prefix redaction on Session, Gateway, and Tools.    | `session.hook`, `gateway.hook`, `tool.hook`    |
| [Prompt injection](src/injection.ts)          | Gateway refusal and Session prompt rewrite for matching text.              | `session.hook`, `gateway.hook`                 |
| [Provider allowlist](src/providers.ts)        | Admit only configured Provider names on Session and Gateway.               | `session.hook`, `gateway.hook`                 |
| [Tool guard](src/tool-guard.ts)               | Refuse Tool calls whose JSON input contains a configured substring.        | `tool.hook`, `gateway.hook`                    |
| [Model routing](src/model-routing.ts)         | A requested-Model pattern routed to a configured destination Model.        | `session.hook`, `gateway.hook`                 |
| [Tool activity](src/tool-activity.ts)         | Structured completion and failure metadata in server logs.                 | `tool.hook`                                    |
| [Request tags](src/request-tags.ts)           | Provider-filtered correlation headers on Session model requests.           | `session.hook`                                 |
| [Retry control](src/retry-control.ts)         | Bounds on proposed automatic Session provider retries.                     | `session.hook`                                 |

## Load selected examples

Add individual source files to Workspace configuration. For a server started from
the repository root:

```jsonc
{
  "plugins": [
    "./plugins/example/src/incident-response.ts",
    "./plugins/example/src/release-review.ts",
    "./plugins/example/src/tool-activity.ts",
    {
      "package": "./plugins/example/src/service-catalog.ts",
      "options": {
        "url": "https://catalog.example.com/mcp",
      },
    },
  ],
}
```

Replace example endpoints and Model identifiers with your company values. Relative
paths in virtual Workspace configuration resolve from the server's working
directory. Use absolute server-local paths when running from another directory.
The examples depend on the installation's `@bymorning/plugin`,
`@bymorning/schema`, and `effect` packages.

This package exposes individual subpath exports for development imports. There is
no aggregate root Plugin: select the source files you want to load.

To use an example as a Project plugin, copy its source to `plugin/<name>.ts` in
the Project. Project entrypoints load automatically and receive empty options;
the declared form defaults still apply. Use a configured source when you need to
supply `plugins[].options` explicitly.

Set `plugins[].options` in Workspace configuration for examples with a
configuration form. Saving validates the form and reloads the Plugin. Keep
credentials in the Integration authentication flow; Plugin options contain
non-secret configuration.

## Company knowledge and workflows

### Company context

Configure the handbook location and load guidance that tells the assistant to
consult it before stating company requirements.

| Option       | Default                                             | Meaning                                                      |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| `source`     | `"local"`                                           | Choose `local` or `git`.                                     |
| `path`       | `"/workspace/company-handbook"`                     | Absolute server-local handbook directory when using `local`. |
| `repository` | `"https://github.com/example/company-handbook.git"` | Credential-free handbook repository URL when using `git`.    |

The example registers Reference `company-handbook` and instruction source
`company-context.md`. Set the path or repository to an existing handbook before
loading it. The local directory must be readable by the server; Git sources must
be reachable from the server. This example accepts HTTPS repository URLs without
embedded credentials, a query, or a fragment.

### Incident response

Load Skill `incident-response` for a production incident. It guides the assistant
through timestamped evidence, impact measurement, competing hypotheses,
mitigation, recovery verification, and an actionable handoff.

Try: “Use the incident-response Skill to investigate elevated errors in billing-api.
Start by collecting evidence and identifying the service owner.”

### Release review

Load Skill `release-review` before promoting a release. It produces a review with
scope, evidence, compatibility concerns, measurable rollout checks, rollback,
and a recommendation with outstanding conditions.

Try: “Use the release-review Skill to review this release diff and deployment plan.
List missing evidence and give a go/no-go recommendation.”

The Skills supply workflows. They use the Tools and evidence available in your
Workspace; they do not connect to monitoring or deployment systems themselves.

## Internal systems

### Service catalog MCP

Set `url` to your internal MCP endpoint. The default,
`https://services.example.com/mcp`, is a placeholder. The Plugin registers MCP
server `example.service-catalog`; that server supplies the actual Tools.
Use an HTTPS URL without embedded credentials, a query, or a fragment.

Try: “Find the owner of billing-api and its incident runbook.”

For authenticated MCP servers, members complete the normal Connection flow.
Registering an endpoint does not authorize another member's account.

### Service lookup REST Tool

Set `baseURL` to your service catalog's HTTPS origin, such as
`https://services.company.example`. The default is
`https://services.example.com`. This example expects this API:

```http
GET /v1/services/billing-api
Authorization: Bearer <member's token>
Accept: application/json
```

```json
{
  "service": "billing-api",
  "owners": ["payments-platform"],
  "runbook": "https://handbook.company.example/runbooks/billing-api"
}
```

Connect the **Service catalog API** Integration
(`example.service-lookup-api`) using its API-token method. Connections are
member-only. The Tool resolves the active Connection at execution time and
asserts Permission `service.lookup` on the exact resource, such as
`service:billing-api`, before accessing the API.

The Tool is `lookup` in namespace `service`, with effective name `service_lookup`.
Its input is `{ "service": "billing-api" }`. Service names use lowercase letters,
digits, and dashes, start with a letter or digit, and contain at most 128 characters.
The base URL accepts an HTTPS origin without credentials, a query, a fragment,
or an API path prefix.

The example uses a 10-second request timeout, refuses redirects, caps response
bodies at 64 KiB, and validates the response shape. Error messages exclude tokens
and upstream response bodies. Adapt the endpoint and response schema to match
your real service catalog.

## Company policies

These examples declare `scope: "workspace"` so they register on Session and LLM
Gateway. Load them through Workspace `plugins` configuration. A Project copy is
skipped because Project discovery stays on the member host.

Permanent Tool restrictions, including shell, are administrator-authored
Permission rules. Durable company guidance is an Instruction source; see
[Company context](#company-context).

### Company policy

Set `restrictProvider` to `true` (the default) to refuse Provider ID `restricted`
from Session and Gateway `model.invoke`. Gateway `model.request` also refuses
when the native model string uses that Provider. Set it to `false` to skip
denial. A returned `ModelError` is an expected refusal.

The example replaces customer identifiers matching `CUST-` followed by exactly
eight digits with `CUST-[redacted]` in Gateway native request bodies, including
nested strings. Session `model.request` cannot return `ModelError` and does not
carry prompt text; Session admission runs at `model.invoke`.

A combined Workspace Config that also sets `gateway` hard caps and `permissions`
is in [`workspace.config.example.jsonc`](../../workspace.config.example.jsonc)
at the repository root.

### Redaction

Enabled by default. Replaces US SSNs, email addresses, and `sk-` / `ghp_` /
`AKIA` prefixes in Session prompts, Gateway request bodies, and Tool input and
output. Set `enabled` to `false` to skip registration.

### Prompt injection

Gateway `model.request` returns `ModelError` when the native body matches
`pattern` (case-insensitive). Session `prompt` cannot refuse; matching Session
text is replaced with `[Request blocked by policy]`. An invalid pattern fails
Plugin activation.

### Provider allowlist

`allowed` is a comma-separated list of Provider names. Empty (the default)
admits every Provider. Non-empty lists deny any other Provider on Session and
Gateway `model.invoke`, and on Gateway `model.request`.

### Tool guard

`tool` is a whole-string name pattern (`*`, `?`). `substring` is a literal
searched in `JSON.stringify(input)`. Matching Session and inbound MCP Tool
calls return `Tool.Error`. Permanent Tool allow/deny still belongs in
`permissions`.

### Model routing

Configure a requested Model pattern and an existing destination Model:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/example/src/model-routing.ts",
      "options": {
        "requested": "requested-provider/*",
        "target": "approved-provider/approved-model",
      },
    },
  ],
}
```

| Option      | Default                                | Meaning                                                                   |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `requested` | `"requested-provider/requested-model"` | Whole-reference `provider/model[#variant]` pattern; supports `*` and `?`. |
| `target`    | `"approved-provider/approved-model"`   | Concrete `provider/model[#variant]` destination.                          |

These identifiers are placeholders. Configure the destination Provider, Model,
and authentication before routing to it. The example registers one shared
`model.request` transform on Session and Gateway. It does not create catalog
entries. `model` is the routing field; the Gateway native body's model selector
is rewritten after destination resolution.

## Operational hooks

### Tool activity

Collect server logs to receive a JSON record for each Session Tool execution that
reaches the `execute.after` hook. Records contain a timestamp, Session, Message,
call, Agent, Tool, and outcome status. Inputs, results, and error bodies are
excluded. This hook does not cover Tool Gateway calls; retention belongs to your
logging infrastructure.

### Request tags

Supply `providerID` and optionally `costCenter`:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/example/src/request-tags.ts",
      "options": {
        "providerID": "company-proxy",
        "costCenter": "engineering/platform",
      },
    },
  ],
}
```

`providerID` is required and must match the effective Provider's key.
`costCenter` accepts a non-secret tag up to 64 characters using letters, numbers,
dot, slash, dash, or underscore, starting with a letter or number. Leave it blank
to omit the tag. The Plugin adds `X-ByMorning-Session-ID`,
`X-ByMorning-Purpose`, and, when configured, `X-ByMorning-Cost-Center`.
Your inference endpoint or proxy must support these headers to make use of them.

The hook applies to Session inference, including its assistant, generation,
compaction, and title purposes. It does not tag LLM Gateway traffic or change
ByMorning's authoritative usage accounting.

### Retry control

| Option       | Default | Meaning                                                                   |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `maxRetries` | `2`     | Maximum proposed automatic retries to permit; `0` vetoes the first retry. |
| `minDelay`   | `1000`  | Minimum retry delay in milliseconds.                                      |

The runner numbers the initial attempt as `1`; the first proposed retry is
attempt `2`. The example preserves an earlier veto and never shortens a proposed
delay. It only restricts retries already proposed by the Session runtime; it does
not make a non-retryable failure retryable or guarantee that two retries occur.
Later hooks can still change the decision.

## Scope and lifecycle

- Contributions enter the Workspace registry, including those loaded from Project
  code. Project source location does not automatically restrict applicability.
- Instruction files can explicitly set `projectID` to restrict their guidance to
  one Project. The company-context example contributes Workspace-wide guidance.
- Instructions enter the conversation context. Skills advertise their metadata
  and load their full instructions on demand. References advertise documentation
  for the model to consult rather than inserting the whole repository.
- Registrations are awaited during setup and removed when the Plugin unloads.
  Removing a Plugin does not erase prior conversation history.
- Directly configured local entrypoint files are watched for reloads. Package
  targets and transitive local imports are not watched.

## Verify locally

Run from `plugins/example/` after installing repository dependencies:

```sh
bun typecheck
bun run test
```

The focused tests exercise example behavior. They do not claim full Application
coverage or live connectivity to company services.

See [the parallel implementation plan](PLAN.md) for the four minion work tracks.
See [the Plugin authoring guide](../../packages/plugin/AGENTS.md) for the public
contract and [the Plugin documentation](../../packages/docs/src/06-developer-reference/03-plugins.mdx)
for additional API examples.
