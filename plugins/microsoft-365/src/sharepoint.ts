import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, registerIntegration, requireOAuth, toolError } from "./graph.js"

const SiteID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const ListID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Top = Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))

const Site = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
})
const Drive = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
})
const ListItem = Schema.Struct({
  id: Schema.String,
  fields: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
const SiteOutput = Site
const DriveList = Schema.Struct({ value: Schema.Array(Drive) })
const DriveListOutput = Schema.Struct({ drives: Schema.Array(Drive) })
const ListItemList = Schema.Struct({ value: Schema.Array(ListItem) })
const ListItemOutput = Schema.Struct({ items: Schema.Array(ListItem) })

function top(value: number | undefined) {
  const resolved = value ?? 10
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) throw toolError("Invalid page size")
  return resolved
}

function decodeEnvelope<A>(value: unknown, decode: (input: unknown) => A): A {
  try {
    return decode(value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/**
 * SharePoint sites, drives, and lists through delegated Microsoft Graph.
 * Search (`/sites?search=`) needs broad delegated scope; application-only
 * Sites.Selected grants cannot search and require per-site grants instead.
 */
const plugin = Plugin.define({
  id: "microsoft-365.sharepoint",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "sharepoint", description: "SharePoint sites, drives, and lists." })
      editor.add({
        name: "site.get",
        description: "Read one SharePoint site by hostname path or site ID.",
        input: Schema.Struct({ siteID: SiteID }),
        output: SiteOutput,
        options: { namespace: "sharepoint", permission: "sharepoint.site.get" },
        execute: async ({ siteID }, toolContext) => {
          await toolContext.permission({ action: "sharepoint.site.get", resources: [`site:${siteID}`] })
          const access = await requireOAuth(context)
          const value = await graphGet(
            `/sites/${encodeURIComponent(siteID)}?$select=id,name,displayName,webUrl`,
            access,
          )
          try {
            return { output: Schema.decodeUnknownSync(Site)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "drive.list",
        description: "List document libraries (drives) in one SharePoint site.",
        input: Schema.Struct({ siteID: SiteID }),
        output: DriveListOutput,
        options: { namespace: "sharepoint", permission: "sharepoint.drive.list" },
        execute: async ({ siteID }, toolContext) => {
          await toolContext.permission({ action: "sharepoint.drive.list", resources: [`site:${siteID}`] })
          const access = await requireOAuth(context)
          const value = await graphGet(`/sites/${encodeURIComponent(siteID)}/drives`, access)
          const decoded = decodeEnvelope(value, (input) => Schema.decodeUnknownSync(DriveList)(input))
          return { output: { drives: decoded.value } }
        },
      })
      editor.add({
        name: "item.list",
        description: "List items in one SharePoint list with their fields.",
        input: Schema.Struct({ siteID: SiteID, listID: ListID, top: Top }),
        output: ListItemOutput,
        options: { namespace: "sharepoint", permission: "sharepoint.item.list" },
        execute: async ({ siteID, listID, top: requested }, toolContext) => {
          await toolContext.permission({
            action: "sharepoint.item.list",
            resources: [`site:${siteID}`, `list:${listID}`],
          })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $top: String(top(requested)), $expand: "fields" })
          const value = await graphGet(
            `/sites/${encodeURIComponent(siteID)}/lists/${encodeURIComponent(listID)}/items?${parameters}`,
            access,
          )
          const decoded = decodeEnvelope(value, (input) => Schema.decodeUnknownSync(ListItemList)(input))
          return { output: { items: decoded.value } }
        },
      })
    })
  },
})

export default plugin
