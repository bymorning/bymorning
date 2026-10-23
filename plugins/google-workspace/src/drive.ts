import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { assertAPIOrigin, clampInt, pathSegment, requestJSON, requestText, toolError } from "./http.js"
import { googleOAuth } from "./oauth.js"

export const drive = {
  pluginID: "google-workspace.drive",
  integrationID: "google-workspace-drive",
  namespace: "drive",
  product: "Google Drive",
  apiOrigin: "https://www.googleapis.com",
  authorizationScopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
} as const

const fileIDPattern = /^[A-Za-z0-9_-]+$/
const mimeTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/
const defaultFields = "id,name,mimeType,modifiedTime,size,parents"
const maxExportBytes = 256 * 1024

const DriveFile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.optionalKey(Schema.String),
  modifiedTime: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.String),
  parents: Schema.optionalKey(Schema.Array(Schema.String)),
})
const FilesListResponse = Schema.Struct({
  files: Schema.optionalKey(Schema.Array(DriveFile)),
  nextPageToken: Schema.optionalKey(Schema.String),
})
const FilesExport = Schema.Struct({ mimeType: Schema.String, text: Schema.String })

const plugin = Plugin.define({
  id: drive.pluginID,
  async setup(context) {
    await context.integration.transform((editor) => {
      editor.update(drive.integrationID, (integration) => {
        integration.name = drive.product
        integration.connectionPolicy = "member-only"
      })
      editor.method.update(
        googleOAuth(
          {
            integrationID: drive.integrationID,
            product: drive.product,
            authorizationScopes: [...drive.authorizationScopes],
          },
          { register: () => context.integration.oauth.callback.register() },
        ),
      )
    })

    await context.tool.transform((editor) => {
      editor.namespace({ name: drive.namespace, description: "Read Google Drive files and metadata." })
      editor.add({
        name: "files_list",
        description: "List Google Drive files matching a query. Omit the query to list recent files.",
        input: Schema.Struct({
          q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1024))),
          pageSize: Schema.optionalKey(Schema.Number),
          pageToken: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1024))),
        }),
        output: Schema.Struct({
          files: Schema.Array(DriveFile),
          nextPageToken: Schema.optionalKey(Schema.String),
        }),
        options: { namespace: drive.namespace, permission: "drive_files_list" },
        execute: async (input, toolContext) => {
          await toolContext.permission({ action: "drive_files_list", resources: ["drive:files"] })
          const access = await driveAccess(context)
          const url = new URL("/drive/v3/files", drive.apiOrigin)
          assertAPIOrigin(url, drive.apiOrigin, "Google Drive request failed")
          if (input.q !== undefined) url.searchParams.set("q", input.q)
          url.searchParams.set("pageSize", String(clampInt(input.pageSize, 1, 100, 20)))
          if (input.pageToken !== undefined) url.searchParams.set("pageToken", input.pageToken)
          url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size,parents),nextPageToken")
          const value = decode(FilesListResponse, await driveJSON(url, access))
          return {
            output: {
              files: value.files ?? [],
              ...(value.nextPageToken ? { nextPageToken: value.nextPageToken } : {}),
            },
          }
        },
      })
      editor.add({
        name: "files_get",
        description: "Read metadata for one Google Drive file by ID.",
        input: Schema.Struct({
          fileId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512), Schema.isPattern(fileIDPattern)),
          fields: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
        }),
        output: DriveFile,
        options: { namespace: drive.namespace, permission: "drive_files_get" },
        execute: async (input, toolContext) => {
          await toolContext.permission({ action: "drive_files_get", resources: [`drive:file:${input.fileId}`] })
          const access = await driveAccess(context)
          const fileId = pathSegment(input.fileId, fileIDPattern, 512, "Google Drive file ID is invalid")
          const url = new URL(`/drive/v3/files/${fileId}`, drive.apiOrigin)
          assertAPIOrigin(url, drive.apiOrigin, "Google Drive request failed")
          url.searchParams.set("fields", input.fields ?? defaultFields)
          return { output: decode(DriveFile, await driveJSON(url, access)) }
        },
      })
      editor.add({
        name: "files_export",
        description: "Export a Google Drive document (Docs, Sheets, Slides) as text in the requested MIME type.",
        input: Schema.Struct({
          fileId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512), Schema.isPattern(fileIDPattern)),
          mimeType: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(128),
            Schema.isPattern(mimeTypePattern),
          ),
        }),
        output: FilesExport,
        options: { namespace: drive.namespace, permission: "drive_files_export" },
        execute: async (input, toolContext) => {
          await toolContext.permission({
            action: "drive_files_export",
            resources: [`drive:file:${input.fileId}:export`],
          })
          const access = await driveAccess(context)
          const fileId = pathSegment(input.fileId, fileIDPattern, 512, "Google Drive file ID is invalid")
          const url = new URL(`/drive/v3/files/${fileId}/export`, drive.apiOrigin)
          assertAPIOrigin(url, drive.apiOrigin, "Google Drive request failed")
          url.searchParams.set("mimeType", input.mimeType)
          const text = await requestText(url, {
            access,
            accept: input.mimeType.startsWith("text/") ? "text/plain" : "*/*",
            maxBytes: maxExportBytes,
            failure: "Google Drive request failed",
          })
          return { output: { mimeType: input.mimeType, text } }
        },
      })
    })
  },
})

type SetupContext = Parameters<typeof plugin.setup>[0]

async function driveAccess(context: SetupContext): Promise<string> {
  const connection = await context.integration.connection.active(drive.integrationID)
  if (connection === undefined) throw toolError("Connect Google Drive before using this Tool")
  const credential = await context.integration.connection.resolve(connection)
  if (credential?.type !== "oauth" || credential.access === "") throw toolError("Reconnect Google Drive")
  return credential.access
}

async function driveJSON(url: URL, access: string): Promise<unknown> {
  return requestJSON(url, { access, failure: "Google Drive request failed" })
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch {
    throw toolError("Google Drive returned an invalid response")
  }
}

export default plugin
