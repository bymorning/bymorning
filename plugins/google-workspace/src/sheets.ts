import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { assertAPIOrigin, pathSegment, requestJSON, toolError } from "./http.js"
import { googleOAuth } from "./oauth.js"

export const sheets = {
  pluginID: "google-workspace.sheets",
  integrationID: "google-workspace-sheets",
  namespace: "sheets",
  product: "Google Sheets",
  apiOrigin: "https://www.googleapis.com",
  authorizationScopes: ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"],
} as const

const spreadsheetIDPattern = /^[A-Za-z0-9_-]+$/
const rangePattern = /^[^\u0000-\u001F\u007F]{1,512}$/

const SheetProperties = Schema.Struct({
  title: Schema.String,
  sheetId: Schema.optionalKey(Schema.Number),
})
const SpreadsheetGet = Schema.Struct({
  sheets: Schema.optionalKey(Schema.Array(Schema.Struct({ properties: Schema.optionalKey(SheetProperties) }))),
})
const RowValues = Schema.Array(Schema.Array(Schema.Unknown))
const ValuesGet = Schema.Struct({
  range: Schema.optionalKey(Schema.String),
  values: Schema.optionalKey(RowValues),
})
const ValuesBatch = Schema.Struct({
  valueRanges: Schema.optionalKey(
    Schema.Array(Schema.Struct({ range: Schema.optionalKey(Schema.String), values: Schema.optionalKey(RowValues) })),
  ),
})

const plugin = Plugin.define({
  id: sheets.pluginID,
  async setup(context) {
    await context.integration.transform((editor) => {
      editor.update(sheets.integrationID, (integration) => {
        integration.name = sheets.product
        integration.connectionPolicy = "member-only"
      })
      editor.method.update(
        googleOAuth(
          {
            integrationID: sheets.integrationID,
            product: sheets.product,
            authorizationScopes: [...sheets.authorizationScopes],
          },
          { register: () => context.integration.oauth.callback.register() },
        ),
      )
    })

    await context.tool.transform((editor) => {
      editor.namespace({ name: sheets.namespace, description: "Read Google Sheets spreadsheets and values." })
      editor.add({
        name: "sheets_get",
        description: "Read spreadsheet metadata: the sheet tabs and their titles.",
        input: Schema.Struct({
          spreadsheetId: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(512),
            Schema.isPattern(spreadsheetIDPattern),
          ),
        }),
        output: Schema.Struct({ sheets: Schema.Array(SheetProperties) }),
        options: { namespace: sheets.namespace, permission: "sheets_sheets_get" },
        execute: async (input, toolContext) => {
          await toolContext.permission({
            action: "sheets_sheets_get",
            resources: [`sheets:spreadsheet:${input.spreadsheetId}`],
          })
          const access = await sheetsAccess(context)
          const id = pathSegment(input.spreadsheetId, spreadsheetIDPattern, 512, "Google Sheets ID is invalid")
          const url = new URL(`/v4/spreadsheets/${id}`, sheets.apiOrigin)
          assertAPIOrigin(url, sheets.apiOrigin, "Google Sheets request failed")
          url.searchParams.set("fields", "sheets.properties.title,sheets.properties.sheetId")
          const value = decode(SpreadsheetGet, await sheetsJSON(url, access))
          return {
            output: {
              sheets: (value.sheets ?? []).flatMap((sheet) =>
                sheet.properties === undefined ? [] : [sheet.properties],
              ),
            },
          }
        },
      })
      editor.add({
        name: "values_get",
        description: "Read values from one A1-notation range, such as Sheet1!A1:C10.",
        input: Schema.Struct({
          spreadsheetId: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(512),
            Schema.isPattern(spreadsheetIDPattern),
          ),
          range: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512), Schema.isPattern(rangePattern)),
        }),
        output: Schema.Struct({ range: Schema.optionalKey(Schema.String), values: RowValues }),
        options: { namespace: sheets.namespace, permission: "sheets_values_get" },
        execute: async (input, toolContext) => {
          await toolContext.permission({
            action: "sheets_values_get",
            resources: [`sheets:spreadsheet:${input.spreadsheetId}:values`],
          })
          const access = await sheetsAccess(context)
          const id = pathSegment(input.spreadsheetId, spreadsheetIDPattern, 512, "Google Sheets ID is invalid")
          const range = pathSegment(input.range, rangePattern, 512, "Google Sheets range is invalid")
          const url = new URL(`/v4/spreadsheets/${id}/values/${range}`, sheets.apiOrigin)
          assertAPIOrigin(url, sheets.apiOrigin, "Google Sheets request failed")
          const value = decode(ValuesGet, await sheetsJSON(url, access))
          return {
            output: {
              ...(value.range ? { range: value.range } : {}),
              values: value.values ?? [],
            },
          }
        },
      })
      editor.add({
        name: "values_batch",
        description: "Read values from up to ten A1-notation ranges in one request.",
        input: Schema.Struct({
          spreadsheetId: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(512),
            Schema.isPattern(spreadsheetIDPattern),
          ),
          ranges: Schema.Array(
            Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512), Schema.isPattern(rangePattern)),
          ).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
        }),
        output: Schema.Struct({
          valueRanges: Schema.Array(
            Schema.Struct({ range: Schema.optionalKey(Schema.String), values: Schema.optionalKey(RowValues) }),
          ),
        }),
        options: { namespace: sheets.namespace, permission: "sheets_values_batch" },
        execute: async (input, toolContext) => {
          await toolContext.permission({
            action: "sheets_values_batch",
            resources: [`sheets:spreadsheet:${input.spreadsheetId}:values`],
          })
          const access = await sheetsAccess(context)
          const id = pathSegment(input.spreadsheetId, spreadsheetIDPattern, 512, "Google Sheets ID is invalid")
          const url = new URL(`/v4/spreadsheets/${id}/values:batchGet`, sheets.apiOrigin)
          assertAPIOrigin(url, sheets.apiOrigin, "Google Sheets request failed")
          for (const range of input.ranges) {
            if (!rangePattern.test(range) || range.length > 512) throw toolError("Google Sheets range is invalid")
            url.searchParams.append("ranges", range)
          }
          url.searchParams.set("fields", "valueRanges(range,values)")
          const value = decode(ValuesBatch, await sheetsJSON(url, access))
          return { output: { valueRanges: value.valueRanges ?? [] } }
        },
      })
    })
  },
})

type SetupContext = Parameters<typeof plugin.setup>[0]

async function sheetsAccess(context: SetupContext): Promise<string> {
  const connection = await context.integration.connection.active(sheets.integrationID)
  if (connection === undefined) throw toolError("Connect Google Sheets before using this Tool")
  const credential = await context.integration.connection.resolve(connection)
  if (credential?.type !== "oauth" || credential.access === "") throw toolError("Reconnect Google Sheets")
  return credential.access
}

async function sheetsJSON(url: URL, access: string): Promise<unknown> {
  return requestJSON(url, { access, failure: "Google Sheets request failed" })
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch {
    throw toolError("Google Sheets returned an invalid response")
  }
}

export default plugin
