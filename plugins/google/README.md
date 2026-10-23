# Google plugin

`@bymorning/plugin-google` is an opt-in workspace package loaded through the package-plugin loader.
It registers the `google-gmail` Integration and six `gmail` Tools. The same prepared Tool
snapshot supplies those Tools to Sessions and the inbound MCP gateway.

```jsonc
{ "plugins": ["@bymorning/plugin-google"] }
```

Use `"-google.gmail.openapi"` in the plugin list to disable it. The package owns the HTTP client used for Google
OAuth token and profile requests. The host owns the Gmail Tool transport, including origin confinement, current
connection lookup, and Permission assertions. Credentials remain in the host Integration service. Configure the
workspace OAuth client, then each member connects their own Google account. Moving the package does not change
plugin, Integration, method, or permission IDs.

The MCP overview lists package plugins alongside MCP servers. Direct Tools and Code Mode
Tools follow the normal `codemode` presentation and Workspace Permission rules.
