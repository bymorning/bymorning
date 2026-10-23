import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphBytes, graphGet, maxContentBytes, registerIntegration, requireOAuth, toolError } from "./graph.js"

const ItemID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))

const FileMeta = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
  file: Schema.optionalKey(Schema.Struct({ mimeType: Schema.optionalKey(Schema.String) })),
})
const FileContentOutput = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  size: Schema.Number,
  truncated: Schema.Boolean,
  preview: Schema.String.check(Schema.isMaxLength(4_000)),
})

const previewLimit = 4_000

/**
 * Word and PowerPoint content through DriveItem download.
 * Graph returns the raw file bytes (OOXML ZIP packages for docx/pptx), so
 * this plugin bounds the download and returns a best-effort text preview;
 * downstream processing extracts document structure.
 */
const plugin = Plugin.define({
  id: "microsoft-365.document",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "document", description: "Word and PowerPoint file content." })
      editor.add({
        name: "file.meta",
        description: "Read metadata for one Word or PowerPoint file.",
        input: Schema.Struct({ itemID: ItemID }),
        output: FileMeta,
        options: { namespace: "document", permission: "document.file.meta" },
        execute: async ({ itemID }, toolContext) => {
          await toolContext.permission({ action: "document.file.meta", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $select: "id,name,webUrl,size,file" })
          const value = await graphGet(`/me/drive/items/${encodeURIComponent(itemID)}?${parameters}`, access)
          try {
            return { output: Schema.decodeUnknownSync(FileMeta)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "file.content",
        description: "Download one Word or PowerPoint file with a bounded best-effort text preview.",
        input: Schema.Struct({ itemID: ItemID }),
        output: FileContentOutput,
        options: { namespace: "document", permission: "document.file.content" },
        execute: async ({ itemID }, toolContext) => {
          await toolContext.permission({ action: "document.file.content", resources: [`drive:me`, `item:${itemID}`] })
          const access = await requireOAuth(context)
          const [meta, content] = await Promise.all([
            graphGet(
              `/me/drive/items/${encodeURIComponent(itemID)}?${new URLSearchParams({ $select: "id,name,file" })}`,
              access,
            ),
            graphBytes(`/me/drive/items/${encodeURIComponent(itemID)}/content`, access, maxContentBytes),
          ])
          let name: string | undefined
          let mimeType: string | undefined
          try {
            const decoded = Schema.decodeUnknownSync(FileMeta)(meta)
            name = decoded.name
            mimeType = decoded.file?.mimeType ?? content.contentType
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
          const text = new TextDecoder("utf-8", { fatal: false }).decode(content.bytes)
          const preview = text.slice(0, previewLimit)
          return {
            output: {
              id: itemID,
              ...(name === undefined ? {} : { name }),
              ...(mimeType === undefined ? {} : { mimeType }),
              size: content.size,
              truncated: content.size >= maxContentBytes || text.length > previewLimit,
              preview,
            },
          }
        },
      })
    })
  },
})

export default plugin
