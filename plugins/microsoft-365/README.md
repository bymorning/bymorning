# Microsoft 365 plugin

`@bymorning/plugin-microsoft-365` contributes seven opt-in Promise-API plugins on the
Microsoft Graph v1.0 base (`https://graph.microsoft.com/v1.0`). Each plugin has a unique
ID, registers the shared member-only Microsoft Entra OAuth Integration, and exposes
namespaced host Tools that resolve the executing member's connection per call.

```jsonc
{
  "plugins": [
    "@bymorning/plugin-microsoft-365/sharepoint",
    "@bymorning/plugin-microsoft-365/onedrive",
    "@bymorning/plugin-microsoft-365/mail",
    "@bymorning/plugin-microsoft-365/calendar",
    "@bymorning/plugin-microsoft-365/teams",
    "@bymorning/plugin-microsoft-365/excel",
    "@bymorning/plugin-microsoft-365/document",
  ],
}
```

## Tools and permission resources

Every Tool calls `permission(...)` with its canonical action and exact resources before
resolving credentials or fetching. An unmatched action defaults to `allow`.

| Plugin ID                  | Namespace    | Tool             | Permission action       | Resources                                       |
| -------------------------- | ------------ | ---------------- | ----------------------- | ----------------------------------------------- |
| `microsoft-365.sharepoint` | `sharepoint` | `site.get`       | `sharepoint.site.get`   | `site:{siteID}`                                 |
| `microsoft-365.sharepoint` | `sharepoint` | `drive.list`     | `sharepoint.drive.list` | `site:{siteID}`                                 |
| `microsoft-365.sharepoint` | `sharepoint` | `item.list`      | `sharepoint.item.list`  | `site:{siteID}`, `list:{listID}`                |
| `microsoft-365.onedrive`   | `onedrive`   | `drive.get`      | `onedrive.drive.get`    | `drive:me`                                      |
| `microsoft-365.onedrive`   | `onedrive`   | `item.get`       | `onedrive.item.get`     | `drive:me`, `item:{itemID}`                     |
| `microsoft-365.onedrive`   | `onedrive`   | `item.list`      | `onedrive.item.list`    | `drive:me`, `item:{itemID}`                     |
| `microsoft-365.mail`       | `mail`       | `message.list`   | `mail.message.list`     | `mail:inbox`                                    |
| `microsoft-365.mail`       | `mail`       | `message.get`    | `mail.message.get`      | `mail:{messageID}`                              |
| `microsoft-365.mail`       | `mail`       | `message.send`   | `mail.message.send`     | `mail:send:{firstRecipient}`                    |
| `microsoft-365.calendar`   | `calendar`   | `event.list`     | `calendar.event.list`   | `calendar:primary`                              |
| `microsoft-365.calendar`   | `calendar`   | `event.get`      | `calendar.event.get`    | `event:{eventID}`                               |
| `microsoft-365.calendar`   | `calendar`   | `event.create`   | `calendar.event.create` | `calendar:primary`                              |
| `microsoft-365.teams`      | `teams`      | `team.list`      | `teams.team.list`       | `teams:joined`                                  |
| `microsoft-365.teams`      | `teams`      | `channel.list`   | `teams.channel.list`    | `team:{teamID}`                                 |
| `microsoft-365.teams`      | `teams`      | `message.list`   | `teams.message.list`    | `team:{teamID}`, `channel:{channelID}`          |
| `microsoft-365.excel`      | `excel`      | `session.create` | `excel.session.create`  | `drive:me`, `item:{itemID}`                     |
| `microsoft-365.excel`      | `excel`      | `worksheet.list` | `excel.worksheet.list`  | `drive:me`, `item:{itemID}`                     |
| `microsoft-365.excel`      | `excel`      | `range.get`      | `excel.range.get`       | `drive:me`, `item:{itemID}`, `worksheet:{name}` |
| `microsoft-365.document`   | `document`   | `file.meta`      | `document.file.meta`    | `drive:me`, `item:{itemID}`                     |
| `microsoft-365.document`   | `document`   | `file.content`   | `document.file.content` | `drive:me`, `item:{itemID}`                     |

## Options

These plugins declare no Workspace configuration. There is nothing to set in
`Config.plugins[].options`; enabling the package subpath is the whole setup.

## Auth

All seven plugins share one Integration (`microsoft-365`) with one OAuth method
(`oauth`) and `member-only` connection policy: each member connects their own
Microsoft account, and every Tool resolves that member's active connection at
execution time. A failed connection never falls back to another identity.

1. Register a **Web application** (confidential client) in Microsoft Entra and add
   exactly `${APP_ORIGIN}/auth/integration/callback` as a redirect URI.
2. Request the delegated scopes the union of Tools needs: `openid`, `profile`,
   `email`, `offline_access`, `Sites.Read.All`, `Files.Read`, `Mail.Read`,
   `Mail.Send`, `Calendars.ReadWrite`, `Team.ReadBasic.All`,
   `Channel.ReadBasic.All`, `ChannelMessage.Read.All`.
3. Configure the Workspace OAuth client (`client_id`, `client_secret`, optional
   `tenant_id` defaulting to `common`), then each member connects personally.

Authorization uses PKCE `S256`. Token exchange requires a refresh token
(`offline_access`); stored credential metadata keeps only the member's Graph `id`
and mail. Refresh loads the current client configuration and preserves the refresh
token when the provider omits a new one.

## Limits

- Native `fetch` with `redirect: "error"` and a 10 second timeout per request.
- JSON responses are bounded at 256 KiB; DriveItem content downloads at 1 MiB.
  Oversized bodies are cancelled and reported as sanitized Tool errors.
- Provider failures map to stable messages (`Microsoft Graph request failed
(status)`, `Microsoft Graph returned an invalid response`). Errors never include
  tokens, secrets, or upstream bodies.
- List pages accept at most 50 items (default 10).

## SharePoint REST gap notes

- This package uses only Microsoft Graph v1.0. It does not call the legacy
  SharePoint REST API (`/_api/web`), so SharePoint-only operations with no Graph
  equivalent (for example taxonomy/term-store administration and some site
  collection admin calls) are out of scope.
- Site search (`GET /sites?search=`) requires broad delegated scopes such as
  `Sites.Read.All`. The application-only `Sites.Selected` permission cannot search
  and requires an explicit per-site grant, so search-capable Tools stay on
  delegated member connections.
- `workbook/createSession` is delegated-only: Excel sessions have no
  application-permission equivalent, which is why the Excel plugin requires the
  member OAuth connection.
- Word and PowerPoint files are read through DriveItem download
  (`GET /drive/items/{id}/content`). Graph returns raw bytes (OOXML ZIP packages
  for `docx`/`pptx`), so `document.file.content` returns a bounded best-effort
  text preview; downstream processing extracts document structure.
