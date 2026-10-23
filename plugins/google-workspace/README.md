# Google Workspace plugin

`@bymorning/plugin-google-workspace` is an opt-in workspace package with four
Promise-API plugins for Google Drive v3, Calendar v3, Sheets v4, and Docs v1.
Each product is an independent loadable plugin with its own member-only OAuth
Integration, product-scoped scopes, and namespaced host Tools. The package
never reuses Gmail scopes and shares no credentials between products.

## Load the products

Configure one entry per product. Each subpath loads exactly one plugin:

```jsonc
{
  "plugins": [
    { "package": "@bymorning/plugin-google-workspace/drive" },
    { "package": "@bymorning/plugin-google-workspace/calendar" },
    { "package": "@bymorning/plugin-google-workspace/sheets" },
    { "package": "@bymorning/plugin-google-workspace/docs" },
  ],
}
```

Disable one product with `"-google-workspace.drive"` (or the matching product
ID). The package root (`./server`) is a barrel for consumers and tests, not a
loadable plugin.

| Plugin ID                   | Integration ID              | Namespace  | Scopes                                     |
| --------------------------- | --------------------------- | ---------- | ------------------------------------------ |
| `google-workspace.drive`    | `google-workspace-drive`    | `drive`    | `openid`, `email`, `drive.readonly`        |
| `google-workspace.calendar` | `google-workspace-calendar` | `calendar` | `openid`, `email`, `calendar.readonly`     |
| `google-workspace.sheets`   | `google-workspace-sheets`   | `sheets`   | `openid`, `email`, `spreadsheets.readonly` |
| `google-workspace.docs`     | `google-workspace-docs`     | `docs`     | `openid`, `email`, `documents.readonly`    |

Scope URLs use the `https://www.googleapis.com/auth/` prefix, for example
`https://www.googleapis.com/auth/drive.readonly`.

## Tools

| Tool                      | Operation                                                  | Permission action         |
| ------------------------- | ---------------------------------------------------------- | ------------------------- |
| `drive.files_list`        | `GET /drive/v3/files`                                      | `drive_files_list`        |
| `drive.files_get`         | `GET /drive/v3/files/{fileId}`                             | `drive_files_get`         |
| `drive.files_export`      | `GET /drive/v3/files/{fileId}/export`                      | `drive_files_export`      |
| `calendar.calendars_list` | `GET /calendar/v3/users/me/calendarList`                   | `calendar_calendars_list` |
| `calendar.events_list`    | `GET /calendar/v3/calendars/{calendarId}/events`           | `calendar_events_list`    |
| `calendar.events_get`     | `GET /calendar/v3/calendars/{calendarId}/events/{eventId}` | `calendar_events_get`     |
| `sheets.sheets_get`       | `GET /v4/spreadsheets/{spreadsheetId}` (metadata)          | `sheets_sheets_get`       |
| `sheets.values_get`       | `GET /v4/spreadsheets/{spreadsheetId}/values/{range}`      | `sheets_values_get`       |
| `sheets.values_batch`     | `GET /v4/spreadsheets/{spreadsheetId}/values:batchGet`     | `sheets_values_batch`     |
| `docs.documents_get`      | `GET /v1/documents/{documentId}` (plain-text extract)      | `docs_documents_get`      |

Every Tool calls `permission(...)` with its canonical action immediately before
the provider request, resolves the member's active connection at execution
time, validates the request origin (`https://www.googleapis.com`), refuses
redirects, applies a 15 s timeout, and bounds response bodies (64 KiB, 256 KiB
for exports and documents). Failures are sanitized `Tool.Error` values that
carry at most a safe status code.

## Options

The plugins declare no Workspace configuration. All non-secret behavior is
fixed per product; credentials live in each product's Integration.

## Auth setup

Each product needs its own Google OAuth web-application client before members
connect. The flow is identical for all four products:

1. Create a Google Cloud **Web application** OAuth client.
2. Add exactly `${APP_ORIGIN}/auth/integration/callback` to its authorized
   redirect URIs. `APP_ORIGIN` is the public ByMorning origin.
3. Enable offline access. The plugin requests `access_type=offline` with an
   explicit consent prompt; Google returns a refresh token on first consent.
4. Request only the scopes in the table above for the products you enable. Do
   not add Gmail scopes; each Integration authorizes its own product.
5. Paste the client ID and secret into the product's **Configure OAuth client**
   form, then each member connects their own Google account. Integrations are
   `member-only`: one member's connection is never visible to another.

Token exchange and refresh send the client secret only in the request body.
Credential metadata stores only the Google subject and email for labels.

## Limitations

- Read-only. The plugins expose no create, update, or delete operations, so
  the requested scopes stay read-only and review-sensitive write scopes are
  avoided.
- Docs returns extracted plain text (title, concatenated text runs, truncation
  flag), not full structural JSON. Large documents are capped at 256 KiB of
  response and 20,000 characters of text.
- Drive export is returned as text up to 256 KiB. Binary exports (PDF blobs,
  images) are not decoded.
- Sheets value reads are bounded by the 64 KiB response cap; wide ranges may
  need narrower A1 selections.
- Moving the package does not change plugin, Integration, method, or
  permission IDs.
