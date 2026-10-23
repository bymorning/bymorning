# Google Workspace MCP plugin

`@bymorning/plugin-google-mcp` is an opt-in workspace package loaded through the package-plugin loader.
It registers the official Google-hosted remote MCP servers selected in its configuration via
`context.mcp.transform`. The host owns the MCP transport, per-member OAuth Connection lookup, and
Permission assertions. No secret material lives in plugin options, metadata, logs, or errors.

```jsonc
{ "plugins": [{ "package": "@bymorning/plugin-google-mcp" }] }
```

Use `"options"` to select servers, for example `{ "enable-chat": false, "enable-universal": true }`.
Every product server is enabled by default except Universal Search, which overlaps the product
servers and stays off unless selected. Use `"-google.workspace-mcp"` in the plugin list to
disable it. Moving the package does not change plugin or MCP server IDs
(`google.workspace-mcp.<server>`).

## Member Connection flow

Registering this plugin in a Workspace only makes the servers available; it does not authorize
any Google account. Each member connects their own Google account through the host MCP Connection
flow (per-member OAuth with the Workspace's Google Cloud OAuth client), and Tools resolve that
member's active Connection at execution time. One member's Connection is never a fallback for
another member. A permitted shared Workspace Connection does not apply to these personal-data
servers.

Before connecting, a Workspace administrator must enable the product APIs plus the matching MCP
services in the Google Cloud project and register the OAuth consent scopes below:

```
gcloud services enable gmailmcp.googleapis.com drivemcp.googleapis.com \
  docsmcp.googleapis.com sheetsmcp.googleapis.com slidesmcp.googleapis.com \
  calendarmcp.googleapis.com chatmcp.googleapis.com people.googleapis.com \
  workspacemcp.googleapis.com --project=PROJECT_ID
```

Google Chat additionally requires a configured Chat app with interactive features off.

## Endpoint table

All endpoints use HTTP transport with OAuth 2.0. Verified against the official
[Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers)
and [Universal Search](https://developers.google.com/workspace/guides/universal-search-mcp) guides.

| Server           | MCP endpoint                                 | MCP service                                        | OAuth scopes                                                                                                                  |
| ---------------- | -------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Gmail            | `https://gmailmcp.googleapis.com/mcp/v1`     | `gmailmcp.googleapis.com`                          | `gmail.readonly`, `gmail.compose`                                                                                             |
| Drive            | `https://drivemcp.googleapis.com/mcp/v1`     | `drivemcp.googleapis.com`                          | `drive.readonly`, `drive.file`                                                                                                |
| Docs             | `https://docsmcp.googleapis.com/mcp/v1`      | `docsmcp.googleapis.com`                           | `drive.readonly`, `drive.file`, `documents.readonly`, `documents`                                                             |
| Sheets           | `https://sheetsmcp.googleapis.com/mcp/v1`    | `sheetsmcp.googleapis.com`                         | `drive.readonly`, `drive.file`, `spreadsheets.readonly`, `spreadsheets`                                                       |
| Slides           | `https://slidesmcp.googleapis.com/mcp/v1`    | `slidesmcp.googleapis.com`                         | `drive.readonly`, `drive.file`, `presentations.readonly`, `presentations`                                                     |
| Calendar         | `https://calendarmcp.googleapis.com/mcp/v1`  | `calendarmcp.googleapis.com`                       | `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.events.readonly`                                      |
| Chat             | `https://chatmcp.googleapis.com/mcp/v1`      | `chatmcp.googleapis.com`                           | `chat.spaces.readonly`, `chat.memberships.readonly`, `chat.messages.readonly`, `chat.messages.create`, `chat.users.readstate` |
| People           | `https://people.googleapis.com/mcp/v1`       | `people.googleapis.com` (no dedicated `*mcp` host) | `directory.readonly`, `userinfo.profile`, `contacts.readonly`                                                                 |
| Universal Search | `https://workspacemcp.googleapis.com/mcp/v1` | `workspacemcp.googleapis.com`                      | `gmail.readonly`, `drive.readonly`, `calendar.readonly`, `chat.messages.readonly` (subset narrows search)                     |

## Tool coverage vs native REST

Published MCP tools per server (from the official guides):

- Gmail (10): `create_draft`, `get_message`, `get_thread`, `label_message`, `label_thread`,
  `list_drafts`, `list_labels`, `search_threads`, `unlabel_message`, `unlabel_thread`.
- Drive (8): `copy_file`, `create_file`, `download_file_content`, `get_file_metadata`,
  `get_file_permissions`, `list_recent_files`, `read_file_content`, `search_files`.
- Docs (2): `read_doc`, `update_doc`.
- Sheets (6): `get_values`, `get_spreadsheet`, `update_spreadsheet`, `update_values`,
  `update_formulas`, `insert_dimension`.
- Slides (2): `read_presentation`, `update_presentation`.
- Calendar (9): `create_event`, `delete_event`, `get_event`, `list_calendars`, `list_events`,
  `respond_to_event`, `search_events`, `suggest_time`, `update_event`.
- Chat (7): `search_conversations`, `list_messages`, `search_messages`, `send_message`,
  `mark_as_read`, `mark_as_unread`, `list_memberships`.
- People (3): `get_user_profile`, `search_contacts`, `search_directory_people`.
- Universal Search (1): `search_corpus` across Gmail, Drive, Calendar, and Chat.

Coverage gaps relative to native REST (absent from the published MCP tool lists):

- Gmail: no message send (drafts only), no trash/delete, no full label CRUD, no history/watch
  push notifications.
- Drive: no delete/trash, no export of Google-native formats, no changes/watch feed, no
  comment/revision management.
- Docs/Sheets/Slides: structural read plus targeted writes only; no full revision history,
  comments, or sharing controls (sharing stays in Drive permissions, itself read-scoped).
- Calendar: event lifecycle is well covered, but there is no calendar-list management, ACL
  handling, or settings access.
- Chat: no space creation/deletion, membership management, or app-only webhook flows.
- People: contacts/directory search and profile only; no contact mutation.
- Universal Search is read-only by design and returns only products whose scopes were granted.

## Preview limitations

- Every server is Developer Preview under the Google Workspace Developer Preview Program;
  product availability, scopes, and verification requirements may change.
- Updated usage quotas apply to new Cloud projects; existing projects keep current quotas.
- Google Chat requires a Chat app configured in the Cloud project.
- Claude clients require an Enterprise, Pro, Max, or Team plan for custom connectors.
- MCP clients inherit the authorizing user's permissions, so untrusted emails, documents, or
  chat messages reachable through these Tools are a prompt-injection surface. Connect only
  trusted clients, screen untrusted inputs, and review agent actions. Google recommends Model
  Armor or an equivalent documented control.

## When to use MCP vs native

- Use this MCP plugin when an agent needs standardized, user-delegated access to Workspace
  data with per-member OAuth, narrow per-product scopes, and no Google API client code to own.
- Use native REST (for example the `google.gmail.openapi` Tools in `@bymorning/plugin-google`)
  when the task needs operations outside the MCP tool lists (sending mail, trash/delete,
  push notifications, revision or ACL management), service-account or domain-wide delegation,
  background execution without a per-member OAuth Connection, or tighter request-level control
  over quotas and retries.
- Use Universal Search when the agent must find context across products first, then use the
  product server (or native REST) for the follow-up action.

The MCP overview lists package plugins alongside MCP servers. Direct Tools and Code Mode
Tools follow the normal `codemode` presentation and Workspace Permission rules.
