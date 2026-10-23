import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, graphWrite, registerIntegration, requireOAuth, toolError } from "./graph.js"

const ItemID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const SessionID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Worksheet = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const Address = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z]+\d+(:[A-Za-z]+\d+)?$/),
)

const WorksheetItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  position: Schema.optionalKey(Schema.Number),
})
const WorksheetListOutput = Schema.Struct({ worksheets: Schema.Array(WorksheetItem) })
const RangeOutput = Schema.Struct({
  address: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.Array(Schema.Unknown))),
})
const SessionOutput = Schema.Struct({ id: Schema.String })

function worksheetPath(itemID: string) {
  return `/me/drive/items/${encodeURIComponent(itemID)}/workbook`
}

function sessionHeaders(sessionID: string | undefined) {
  return sessionID === undefined ? undefined : { "Workbook-Session-Id": sessionID }
}

function decodeList(value: unknown) {
  if (typeof value !== "object" || value === null || !("value" in value) || !Array.isArray(value.value)) {
    throw toolError("Microsoft Graph returned an invalid response")
  }
  try {
    return Schema.decodeUnknownSync(Schema.Array(WorksheetItem))(value.value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/**
 * Excel workbooks stored in OneDrive or SharePoint through delegated Microsoft Graph.
 * `workbook/createSession` is delegated-only: it has no application-permission
 * equivalent, so this member-only OAuth plugin is the supported caller.
 */
const plugin = Plugin.define({
  id: "microsoft-365.excel",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "excel", description: "Excel workbooks in OneDrive or SharePoint." })
      editor.add({
        name: "session.create",
        description: "Open a delegated workbook session. Application permissions cannot create sessions.",
        input: Schema.Struct({
          itemID: ItemID,
          persist: Schema.optionalKey(Schema.Boolean),
        }),
        output: SessionOutput,
        options: { namespace: "excel", permission: "excel.session.create" },
        execute: async ({ itemID, persist }, toolContext) => {
          await toolContext.permission({ action: "excel.session.create", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const value = await graphWrite(`${worksheetPath(itemID)}/createSession`, access, "POST", {
            persistChanges: persist ?? false,
          })
          try {
            return { output: Schema.decodeUnknownSync(SessionOutput)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "worksheet.list",
        description: "List worksheets in one workbook.",
        input: Schema.Struct({ itemID: ItemID, sessionID: Schema.optionalKey(SessionID) }),
        output: WorksheetListOutput,
        options: { namespace: "excel", permission: "excel.worksheet.list" },
        execute: async ({ itemID, sessionID }, toolContext) => {
          await toolContext.permission({ action: "excel.worksheet.list", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $select: "id,name,position" })
          const value = await graphGet(
            `${worksheetPath(itemID)}/worksheets?${parameters}`,
            access,
            sessionHeaders(sessionID),
          )
          return { output: { worksheets: decodeList(value) } }
        },
      })
      editor.add({
        name: "range.get",
        description: "Read values from one worksheet range, for example A1:B2.",
        input: Schema.Struct({
          itemID: ItemID,
          worksheet: Worksheet,
          address: Address,
          sessionID: Schema.optionalKey(SessionID),
        }),
        output: RangeOutput,
        options: { namespace: "excel", permission: "excel.range.get" },
        execute: async ({ itemID, worksheet, address, sessionID }, toolContext) => {
          await toolContext.permission({
            action: "excel.range.get",
            resources: [`drive:me`, `item:${itemID}`, `worksheet:${worksheet}`],
          })
          const access = await requireOAuth(context)
          const encoded = encodeURIComponent(worksheet)
          const value = await graphGet(
            `${worksheetPath(itemID)}/worksheets/${encoded}/range(address='${encodeURIComponent(address)}')`,
            access,
            sessionHeaders(sessionID),
          )
          try {
            return { output: Schema.decodeUnknownSync(RangeOutput)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
    })
  },
})

export default plugin
