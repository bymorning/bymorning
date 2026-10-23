import { define } from "@bymorning/plugin/effect/plugin"
import { SkillSchema } from "@bymorning/schema/skill"
import { Effect } from "effect"

/** Guidance for authoring automatically activated Project plugin contributions. */
export const BymorningSkill = SkillSchema.Info.make({
  id: SkillSchema.ID.make("bymorning"),
  name: "Bymorning",
  description:
    "Use when the user asks to create or update an Integration, Plugin, custom Agent, Skill, or Tool. Not for recurring schedules; those are Scheduled Tasks.",
  instructions: `Plugins belong to the current Project. Use \`read\`, \`write\`, and \`edit\` with paths under \`plugin/\`. Never pass a filesystem path.

Workspace policy, Skills, and MCP servers are not Project files. Use the Session Code Mode catalog:

- \`tools.toolkit.policy.get\` / \`update\` for gateway RPM, TPM, model allowlist, Provider allowlist, Routing, and Permission rules
- \`tools.toolkit.skill.list\` / \`get\` / \`create\` / \`update\` / \`delete\` for Workspace Skills
- \`tools.toolkit.mcp.list\` / \`put\` / \`remove\` for outbound MCP configuration; \`connect\` / \`disconnect\` / \`status\` for the live connection
- \`tools.toolkit.integration.list\` for every registered Integration, its methods, whether an OAuth method's client is configured, and whether this member is connected; \`connect\` / \`status\` for Integration OAuth
- \`tools.toolkit.plugin.list\` for the plugin inventory: each plugin's \`source\`, \`status\` (\`active\` or \`failed\`), redacted \`error\`, and contributed \`tools\` and \`integrations\`

Do not invent a policy Plugin or edit Workspace Config documents to do those jobs. Permanent Tool allow/deny/ask belongs in \`toolkit.policy.update\`, not a Session \`execute.before\` hook.

Activation is automatic and asynchronous. A successful \`write\` or \`edit\` of an entrypoint triggers it, and the next assistant execution waits for it, so contributions are available on the next assistant execution. Activation is not confirmed by the write succeeding: you MUST verify it with \`tools.toolkit.plugin.list({ source: "project" })\` on the next assistant execution, before reporting the plugin as working or telling the user what to do next.

A verified row looks like \`{ "id": "project.example", "source": { "type": "project", "path": "plugin/example.ts" }, "status": "active" }\`; an Integration plugin also lists \`"integrations": ["example"]\` and a Tool plugin lists \`"tools": [...]\`. A failed row usually has no \`id\` and looks like \`{ "source": { "type": "project", "path": "plugin/example.ts" }, "status": "failed", "error": "Plugin failed to load", "ref": "err_1a2b3c4d" }\`. The \`error\` is redacted; the \`ref\` correlates with the server log. When a row is failed: \`read\` the entrypoint, fix the TypeScript (imports must be exactly those shown in this Skill; the module must export the definition as \`default\` or \`plugin\`; the plugin ID must be unique), write it again, and verify again. Report the failure and the \`ref\` to the user instead of describing the plugin as installed. If the row is missing entirely, the path is not an entrypoint (\`plugin/<slug>.ts\` or \`plugin/<slug>/index.ts\`) or the file did not write.

Use a single-purpose authoring run:

1. Classify each explicitly requested capability as Integration, Plugin, Agent, Skill, or Tool.
2. Follow only the matching capability branches below.
3. Write one entrypoint per requested capability, unless the user explicitly requests one plugin that provides several capabilities.
4. On the next assistant execution, verify every written entrypoint with \`tools.toolkit.plugin.list({ source: "project" })\`. Then report each created capability, its path, and its inventory status. For a Tool, additionally invoke the contributed Tool by name and report its direct result.

Completion: the contributed capabilities exactly match the user's request. A Plugin, Agent, Skill, or Integration is complete only after its entrypoint has been written and its inventory row shows \`status: "active"\` on the next assistant execution. A Tool is complete only after that and the contributed Tool has been directly invoked once. Never describe a plugin as installed, activated, or connected from the write result alone.

Every authored Project entrypoint is at \`plugin/<slug>.ts\` or \`plugin/<slug>/index.ts\`. An Agent, Skill, or Tool is a contribution made by a plugin, not another discovered file type.

Before editing an existing Project plugin, use \`read\` to inspect it. Write complete, valid TypeScript rather than partial snippets.

## Create a plugin

Use this when the user requests plugin lifecycle behavior without an Agent, Skill, or Tool. It is also the probe: write it as \`plugin/probe.ts\` with \`id: "project.probe"\` when you need to check that Project plugins load at all in this installation; it contributes nothing and the user can remove the file afterwards.

\`\`\`ts
import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.example",
  effect: () => Effect.void,
})
\`\`\`

## Create an Agent

Create one Agent plugin and change only the plugin ID, Agent name, and Agent fields:

\`\`\`ts
import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.agent.reviewer",
  effect: (context) =>
    Effect.asVoid(
      context.agent.transform((editor) => {
        editor.update("reviewer", (agent) =>
          Object.assign(agent, {
            instructions: "Review for correctness, regressions, and missing tests.",
            steps: 8,
          }),
        )
      }),
    ),
})
\`\`\`

## Create a Skill

A Skill is a declarative instruction bundle. The existing built-in \`skill\` Tool loads its instructions by Skill ID, so the Skill plugin is complete once it contributes \`Skill.Info\`.

Create one Skill plugin. Use a stable, descriptive kebab-case Skill ID; do not generate a random ID:

\`\`\`ts
import { Plugin, Skill } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.skill.review-work",
  effect: (context) =>
    Effect.asVoid(
      context.skill.transform((editor) => {
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("review-work"),
            name: "Review work",
            description: "Review the current work for correctness.",
            instructions: "Check correctness, regressions, and missing tests.",
          }),
        )
      }),
    ),
})
\`\`\`

## Create a Tool

Create one Tool plugin and define the Tool inline in \`editor.add\`:

\`\`\`ts
import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "project.tool.echo",
  effect: (context) =>
    Effect.asVoid(
      context.tool.transform((editor) => {
        editor.add({
          name: "echo",
          description: "Echo text back to the caller.",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execution: "sandbox",
          implementation: {
            type: "inline",
            language: "typescript",
            body: \`return {
  output: input.text,
  content: [{ type: "text", text: input.text }],
}\`,
          },
        })
      }),
    ),
})
\`\`\`

The implementation body runs in the configured code execution sandbox, not in the server process. It receives decoded Tool input as \`input\` and must return a Tool result object. Use exactly \`python\`, \`javascript\`, or \`typescript\`. For an existing Project source file, import \`ProjectDirectory\` from \`@bymorning/schema/project-directory\` and use \`implementation: { type: "project-file", path: ProjectDirectory.Path.make("scripts/task.ts") }\`; the file is loaded from the registering Project at invocation time.

Only when the user explicitly requests trusted server-process behavior, register an executable \`Tool.Info\` with an Effect \`execute\` callback and no execution discriminator. The callback receives \`execution.caller\` (a Session or gateway caller), \`execution.id\`, \`execution.progress\`, and \`execution.permission\`. Never convert a callback to sandbox execution implicitly. The same prepared snapshot presents \`options.codemode: false\` Tools directly to Sessions and inbound MCP; other Tools use the shared \`execute\` Code Mode catalog. Invoke a contributed Tool through its presented direct name or exact Code Mode path, not an invented catalog API.

## Route model requests

Use \`context.session.hook("model.request", ...)\` to route one physical inference request. \`requestedModel\` is the Session's logical selection; mutable \`model\` is the effective destination. Routing can target only executable registry models and never changes the Session selection. Check \`purpose\` to distinguish assistant, generate, compaction, and title requests. The same hook can set \`baseURL\` and \`headers\` for a request-scoped transport destination.

This example routes assistant requests only; both model IDs must be available through the selected Provider:

\`\`\`typescript
import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.routing.assistant",
  effect: (context) =>
    Effect.asVoid(
      context.session.hook("model.request", (event) =>
        Effect.sync(() => {
          if (event.purpose === "assistant" && event.requestedModel.id === "gpt-5.6-sol") {
            event.model = { provider: event.requestedModel.provider, id: "gpt-5.6-terra" }
          }
        }),
      ),
    ),
})
\`\`\`

Use the optional \`{ providerID: "..." }\` registration argument on Session hooks only when a hook should match the callback-time effective provider.

Tool execution hooks are separate from model request hooks. \`execute.before\` receives \`tool\`, \`input\`, \`sessionID\`, \`agent\`, \`messageID\`, and \`id\`; it has no model fields or provider filter. Do not infer the effective model from the Session's logical selection or store request state in a shared variable. For a requested Session Tool rule independent of model routing, inspect the actual Tool name or input. Promise callbacks return a real \`Tool.Error\` to deny; throwing or rejecting is a plugin defect. This example denies the \`shell\` Tool for every Session call, not only routed requests:

\`\`\`typescript
import { Plugin, Tool } from "@bymorning/plugin"

export default Plugin.define({
  id: "project.policy.no-shell",
  async setup(context) {
    await context.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell") return
      return new Tool.Error({ message: "shell is prohibited by this Session Tool rule" })
    })
  },
})
\`\`\`

These Tool hooks run for Session calls, not gateway calls. Every trusted Tool must still assert \`execution.permission\` immediately before its sensitive operation for either caller type.

## Create an Integration with a Tool

Before authoring, call \`tools.toolkit.integration.list({})\`. ByMorning ships built-in Integrations, for example \`google-gmail\` (Google Gmail, OAuth method \`oauth\`, member-only connections) with its Gmail Tools; if a built-in Integration covers the request, do not author another one. Instead, report its \`configured\` and \`connected\` state and guide the user through the permission model below.

Permission model for every Integration, built-in or authored:

- An OAuth method's client (OAuth client ID and client secret) is Workspace configuration, saved once by a Workspace administrator on the Console's Integrations page (\`/w/<workspaceID>/mcp\`). \`tools.toolkit.integration.list\` and \`tools.toolkit.integration.status\` show it as \`configured: true | false\` on the method and never reveal the values. It is not an application-level credential, not a plugin option, and not something a plugin or a member can set.
- Each member then connects their own account with \`tools.toolkit.integration.connect({ integrationID, methodID })\` (returns an authorization URL; the user opens it) or through the command palette entry "Connect integration". A \`connectionPolicy\` of \`member-only\` means a shared Workspace connection is not allowed. A Tool resolves the calling member's active connection at execution time; one member's connection never serves another.
- If \`configured\` is false and the user is not a Workspace administrator, tell them an administrator must configure the OAuth client first on the Console's Integrations page. Do not point to a "Settings" section; there is none.

An Integration describes connection methods and resolves the active connection at execution time; a Tool performs the connected operation. Contribute both with \`context.integration.transform\` and \`context.tool.transform\`. Do not register a provider in Core. After writing, verify activation with \`tools.toolkit.plugin.list\` (the row lists the Integration ID under \`integrations\`), then tell the user what remains: administrator client configuration if the method declares \`client\` fields, and their own connection before invoking its Tool. For browser OAuth, use \`context.integration.oauth.callback.register()\` to obtain the host-generated state, callback URI, expiry, and scoped one-use waiter; never add a provider-specific callback route or choose OAuth state yourself.

An OAuth method is registered with \`editor.method.update\` using exactly this shape: \`method: { id, type: "oauth", label, form?, client? }\` where \`client\` is the administrator-configured field list (mark the secret field \`secret: true\`) and \`form\` is an optional per-connection field list; \`authorize(answer, clientAnswer)\` returns \`{ mode: "auto", url, instructions, expiresAt?, callback }\` where \`callback\` is an Effect that waits for the host callback and exchanges the code for a \`Credential.OAuth\` (\`{ type: "oauth", methodID, access, refresh, expires, metadata? }\`); optional \`refresh(credential, clientAnswer)\` returns a renewed \`Credential.OAuth\`; optional \`label(credential)\` names the connection. Authorization-code flows with PKCE follow this compact example, derived from the built-in Gmail plugin:

\`\`\`typescript
import { Credential, Integration, Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

const Token = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
  refresh_token: Schema.optionalKey(Schema.String),
})
const Client = Schema.Struct({ client_id: Schema.String, client_secret: Schema.String })
const post = (url: string, body: Record<string, string>) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { method: "POST", body: new URLSearchParams(body) })
      if (!response.ok) throw new Error("token request failed")
      return Schema.decodeUnknownSync(Token)(await response.json())
    },
    catch: () => new Error("Example token request failed"),
  })

export default Plugin.define({
  id: "project.integration.example",
  effect: (context) =>
    Effect.asVoid(
      context.integration.transform((editor) => {
        editor.update("example", (integration) => {
          integration.name = "Example"
          integration.connectionPolicy = "member-only"
        })
        editor.method.update({
          integrationID: "example",
          method: {
            id: "oauth",
            type: "oauth",
            label: "Example OAuth web app",
            client: [
              { key: "client_id", type: "string", title: "OAuth client ID", required: true },
              { key: "client_secret", type: "string", title: "OAuth client secret", required: true, secret: true },
            ],
          },
          authorize: (_answer, clientAnswer) =>
            Effect.gen(function* () {
              const client = yield* Schema.decodeUnknownEffect(Client)(clientAnswer)
              const callback = yield* context.integration.oauth.callback.register()
              const url = new URL("https://example.com/oauth/authorize")
              url.search = new URLSearchParams({
                client_id: client.client_id,
                redirect_uri: callback.callbackURI,
                response_type: "code",
                scope: "read",
                state: callback.state,
              }).toString()
              return {
                mode: "auto" as const,
                url: url.href,
                instructions: "Complete Example authorization in your browser, then return to ByMorning.",
                expiresAt: callback.expiresAt,
                callback: Effect.gen(function* () {
                  const response = yield* callback.wait
                  if ("error" in response) return yield* Effect.fail(new Error("Example authorization failed"))
                  const token = yield* post("https://example.com/oauth/token", {
                    client_id: client.client_id,
                    client_secret: client.client_secret,
                    code: response.code,
                    grant_type: "authorization_code",
                    redirect_uri: callback.callbackURI,
                  })
                  if (token.refresh_token === undefined) return yield* Effect.fail(new Error("No refresh token"))
                  return Credential.OAuth.make({
                    type: "oauth",
                    methodID: Integration.MethodID.make("oauth"),
                    access: token.access_token,
                    refresh: token.refresh_token,
                    expires: Date.now() + token.expires_in * 1_000,
                  })
                }),
              }
            }),
          refresh: (credential, clientAnswer) =>
            Effect.gen(function* () {
              const client = yield* Schema.decodeUnknownEffect(Client)(clientAnswer)
              const token = yield* post("https://example.com/oauth/token", {
                client_id: client.client_id,
                client_secret: client.client_secret,
                refresh_token: credential.refresh,
                grant_type: "refresh_token",
              })
              return Credential.OAuth.make({
                ...credential,
                access: token.access_token,
                refresh: token.refresh_token ?? credential.refresh,
                expires: Date.now() + token.expires_in * 1_000,
              })
            }),
        })
      }),
    ),
})
\`\`\`

A Tool for that Integration resolves the connection at execution time exactly as in the key example below, except that the resolved credential has \`credential.type === "oauth"\` and the bearer token is \`credential.access\`.

Use \`context.tool.openapi\` for host-owned OpenAPI Tool registration. Supply \`namespace\`, \`permissionPrefix\`, \`spec\`, \`expectedOrigin\`, and explicit \`authentication\`; resolve Integration credentials at invocation, never during setup. The host callback below is trusted server execution, so validate inputs and send credentials only to the Integration's declared hosts:

\`\`\`typescript
import { Plugin, Tool } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "account.example",
  effect: (context) => Effect.all([
    context.integration.transform((editor) => {
      editor.update("example", (integration) => { integration.name = "Example" })
      editor.method.update({ integrationID: "example", method: { type: "key", label: "API key" } })
    }),
    context.tool.transform((editor) => editor.add({
      name: "example_status", description: "Read Example status.", input: Schema.Struct({}), output: Schema.Unknown,
      options: { permission: "example" },
      execute: (_input, execution) => Effect.gen(function* () {
        const connection = yield* context.integration.connection.active("example")
        if (!connection) return yield* new Tool.Error({ message: "Connect Example before using this tool" })
        const credential = yield* context.integration.connection.resolve(connection).pipe(
          Effect.mapError(() => new Tool.Error({ message: "Reconnect Example" })),
        )
        if (credential?.type !== "key") return yield* new Tool.Error({ message: "Reconnect Example" })
        yield* execution.permission({ action: "example", resources: ["status"], save: ["*"] })
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch("https://api.example.com/status", {
              headers: { Authorization: \`Bearer \${credential.key}\` },
            })
            if (!response.ok) throw new Error("Example request failed")
            return { output: await response.json() }
          },
          catch: () => new Tool.Error({ message: "Example request failed" }),
        })
      }),
    })),
  ], { discard: true }),
})
\`\`\`

The templates and contracts in this Skill are authoritative for authored plugins. Do not claim to inspect installed package declarations or arbitrary host files. Use the supplied Session Code Mode catalog and its \`search\` helper, when available, to discover callable paths; there is no separate catalog-inspection API. When a provider needs additional OAuth fields, endpoints, or OpenAPI operations, derive those details from the user's request or supplied provider documentation while keeping the Integration, callback, connection, permission, and Tool boundaries shown here.

Keep each plugin ID distinct from the Agent name, Skill ID, or Tool name it contributes. Never add explicit \`Tool.Info\` generics or invent helper factories such as \`Plugin.makeTool\` or \`Plugin.makeAgent\`. Do not import internal Core modules.

Respect existing file permission prompts. Plugin setup executes in the server process, but custom Tool implementations are sandbox-first.

An @ reference remains text. To execute an existing source reference such as \`@script.ts\`, invoke the built-in \`run\` Tool with path \`script.ts\`; do not add protocol or composer behavior.

The contributed Tool is the only execution path. The next assistant execution waits for plugin activation before resolving its instructions and Tools; \`tools.toolkit.plugin.list\` is how you confirm what that activation produced.`,
})

/** Core Bymorning Skill plugin. */
export const BymorningPlugin = define({
  id: "core.skill.bymorning",
  effect: (context) => Effect.asVoid(context.skill.transform((editor) => editor.add(BymorningSkill))),
})
