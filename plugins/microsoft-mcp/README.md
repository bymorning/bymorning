# Microsoft 365 MCP plugin

`@bymorning/plugin-microsoft-mcp` registers official Microsoft Agent 365 / Work IQ
remote MCP servers through `mcp.transform`. It contributes endpoint configuration
only; authentication stays in the host Connection flow and no credentials live in
plugin options.

```jsonc
{
  "plugins": [
    {
      "package": "@bymorning/plugin-microsoft-mcp",
      "options": {
        "tenantId": "12345678-1234-1234-1234-1234567890ab",
        "servers": ["mcp_MailTools", "mcp_CalendarTools", "mcp_TeamsServer"],
      },
    },
  ],
}
```

| Option     | Default                         | Meaning                                                              |
| ---------- | ------------------------------- | -------------------------------------------------------------------- |
| `tenantId` | required                        | Entra directory (tenant) ID; must be a GUID. Scopes gateway URLs.    |
| `servers`  | all workload servers below      | Subset of server IDs to register. `enterprise` is opt-in.            |

## Servers

Tenant-level servers follow
`https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/{serverID}`
and authenticate the signed-in member through the normal Connection flow.

| Option value                | MCP name              | Scope                      | What you get                                                              |
| --------------------------- | --------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `mcp_SharePointRemoteServer` | `microsoft.sharepoint` | SharePoint sites and files | Sites, lists, items, columns, libraries, files and folders up to 5 MB.    |
| `mcp_OneDriveRemoteServer`   | `microsoft.onedrive`   | Signed-in user's OneDrive  | Personal files and folders up to 5 MB, sharing, sensitivity labels.       |
| `mcp_MailTools`              | `microsoft.mail`       | Outlook mail               | Draft, send, reply and reply-all, update, delete, KQL search, sent items. |
| `mcp_CalendarTools`          | `microsoft.calendar`   | Outlook calendar           | Create, list, update, delete events; accept, decline, cancel; free/busy.  |
| `mcp_TeamsServer`            | `microsoft.teams`      | Teams chats and channels   | Chat and channel CRUD, plain-text messages and replies, member roles.     |
| `mcp_WordServer`             | `microsoft.word`       | Word documents             | Create documents in OneDrive root, read content, add and reply comments.  |
| `mcp_M365Copilot`            | `microsoft.copilot`    | Org-wide Copilot search    | Multi-turn Copilot chat grounded in files across Microsoft 365.           |
| `enterprise`                 | `microsoft.enterprise` | Entra directory (read-only)| Fixed URL `https://mcp.svc.cloud.microsoft/enterprise`; Graph-backed directory queries. |

## Prerequisites

- Register an Entra application (client) for the coding-agent flow and note its
  application (client) ID and directory (tenant) ID. Add the API permissions
  matching the servers you enable (for example `McpServers.Mail.All`,
  `McpServers.Calendar.All`, `McpServers.Teams.All`,
  `McpServers.OneDriveSharePoint.All`, `McpServers.Word.All`,
  `McpServers.CopilotMCP.All`, or the `WorkIQ-*` equivalents) and consent to them.
- Members need a Microsoft 365 Copilot license to use the Agent 365 / Work IQ
  servers.
- Admins govern server availability in the Microsoft 365 admin center
  (**Agents and Tools**): they can allow or block servers and apply scoped
  permissions. Blocked servers stay blocked for every user and agent.

## Preview limits

All servers are Microsoft previews: not for production use, and tool names or
parameters may change, so avoid hard-coded dependencies.

- File operations on SharePoint and OneDrive are limited to files of 5 MB or less
  for upload and download. Copy and move are asynchronous; poll the returned
  operation token.
- Word supports create, read, and comments only: new documents land in the root
  of the user's OneDrive, reads need a SharePoint or OneDrive sharing URL, and
  comment calls need the `driveId`/`documentId` from a prior read.
- The Enterprise directory server is read-only (suggest queries, run Graph GETs,
  list entity schemas). It honors user roles, granted scopes, and Graph
  throttling, limited to about 100 calls per minute per user.
- Work IQ write operations additionally require an administrator to turn them on
  in the Microsoft 365 admin center.

## When MCP vs Microsoft Graph

Use these MCP servers when an agent should act on Microsoft 365 through governed,
auditable Tools: sending mail, scheduling meetings, posting Teams messages,
managing files, drafting Word documents, or grounding answers in Copilot search.
Every call runs as the signed-in member under admin-approved servers, scoped
permissions, and Defender-observable traces.

Call Microsoft Graph directly instead when the work needs bulk or paginated reads
beyond the 5 MB / top-20 MCP caps, app-only (non-delegated) flows such as
autonomous background jobs, write operations the preview MCP servers do not
expose, or raw response fidelity for reporting and automation scripts. The
Enterprise MCP server never replaces direct Graph access: it is a delegated,
read-only, natural-language query surface over directory data.

## Verify locally

Run from `plugins/microsoft-mcp/` after installing repository dependencies:

```sh
bun typecheck
bun run test
```

The focused tests exercise option validation and URL construction. They do not
claim live connectivity to Microsoft endpoints.

## References

- [Work IQ MCP overview (preview)](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)
- [SharePoint reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools)
- [OneDrive reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-onedrive-tools)
- [Mail reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-mail-tools)
- [Calendar reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-calendar-tools)
- [Teams reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-teams-tools)
- [Word reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools)
- [Copilot reference (preview)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-copilot-tools)
- [Enterprise MCP Server overview](https://learn.microsoft.com/en-us/graph/mcp-server/overview)
