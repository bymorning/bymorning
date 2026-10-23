import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, registerIntegration, requireOAuth, toolError } from "./graph.js"

const ItemID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Top = Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))

const Drive = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  driveType: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
})
const DriveItem = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
  folder: Schema.optionalKey(Schema.Unknown),
  file: Schema.optionalKey(Schema.Unknown),
})
const DriveItemListOutput = Schema.Struct({ items: Schema.Array(DriveItem) })

function pageSize(value: number | undefined) {
  const resolved = value ?? 10
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) throw toolError("Invalid page size")
  return resolved
}

function decodeList(value: unknown) {
  if (typeof value !== "object" || value === null || !("value" in value) || !Array.isArray(value.value)) {
    throw toolError("Microsoft Graph returned an invalid response")
  }
  try {
    return Schema.decodeUnknownSync(Schema.Array(DriveItem))(value.value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/** The signed-in member's OneDrive through delegated Microsoft Graph. */
const plugin = Plugin.define({
  id: "microsoft-365.onedrive",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "onedrive", description: "The signed-in member's OneDrive." })
      editor.add({
        name: "drive.get",
        description: "Read the signed-in member's OneDrive.",
        input: Schema.Struct({}),
        output: Drive,
        options: { namespace: "onedrive", permission: "onedrive.drive.get" },
        execute: async (_input, toolContext) => {
          await toolContext.permission({ action: "onedrive.drive.get", resources: ["drive:me"] })
          const access = await requireOAuth(context)
          const value = await graphGet("/me/drive?$select=id,name,driveType,webUrl", access)
          try {
            return { output: Schema.decodeUnknownSync(Drive)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "item.get",
        description: "Read one OneDrive item by ID.",
        input: Schema.Struct({ itemID: ItemID }),
        output: DriveItem,
        options: { namespace: "onedrive", permission: "onedrive.item.get" },
        execute: async ({ itemID }, toolContext) => {
          await toolContext.permission({ action: "onedrive.item.get", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const value = await graphGet(`/me/drive/items/${encodeURIComponent(itemID)}`, access)
          try {
            return { output: Schema.decodeUnknownSync(DriveItem)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "item.list",
        description: "List children of one OneDrive folder. Use root for the drive root.",
        input: Schema.Struct({ itemID: ItemID, top: Top }),
        output: DriveItemListOutput,
        options: { namespace: "onedrive", permission: "onedrive.item.list" },
        execute: async ({ itemID, top }, toolContext) => {
          await toolContext.permission({ action: "onedrive.item.list", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $top: String(pageSize(top)) })
          const value = await graphGet(`/me/drive/items/${encodeURIComponent(itemID)}/children?${parameters}`, access)
          return { output: { items: decodeList(value) } }
        },
      })
    })
  },
})

export default plugin
