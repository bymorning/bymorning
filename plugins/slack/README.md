# Slack plugin

`@bymorning/plugin-slack` contributes the Slack Integration and Slack's remote MCP
server. It is opt-in:

```jsonc
{ "plugins": ["@bymorning/plugin-slack"] }
```

ByMorning has no first-party Slack bot. This plugin lets a Session search, read, and
post in Slack through Slack's remote MCP server under each member's Slack permissions.
Talking to ByMorning from Slack is a different integration and is not this plugin.

Slack does not support dynamic client registration. Create your own internal Slack app
and ask a workspace admin to approve MCP.

## Create a Slack app

1. Create an **internal** app at [api.slack.com/apps](https://api.slack.com/apps).
   Unlisted apps cannot use MCP.
2. Turn on **Model Context Protocol** in the app settings.
3. Add a bot user. Slack's user-token authorize endpoint refuses apps that have none.
4. Under **OAuth & Permissions**, add the [user token scopes](https://docs.slack.dev/ai/slack-mcp-server#oauth-scopes)
   for the MCP tools you want. The plugin requests the full Slack MCP user-scope set.
5. Add this redirect URL, using your public ByMorning origin:

   `${APP_ORIGIN}/auth/integration/callback`

6. Copy the app's **Client ID** and **Client Secret**.
7. Ask a workspace admin to approve the MCP integration.

Do not use a localhost OpenCode callback. ByMorning owns `${APP_ORIGIN}/auth/integration/callback`.
Do not enable Slack's public-client PKCE app setting; ByMorning exchanges tokens as a
confidential web app.

Slack's setup: [Slack MCP server](https://docs.slack.dev/ai/slack-mcp-server) and
[connect to harnesses](https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses).

## Connect in ByMorning

Configure the workspace Slack OAuth client with that Client ID and Client Secret, then
each member connects their own Slack account. Credentials stay in the Integration;
do not put the client secret in plugin options or Workspace MCP configuration.

The plugin registers `https://mcp.slack.com/mcp` with `oauth: false` and sends the
member's user token as a Bearer header after they connect.
