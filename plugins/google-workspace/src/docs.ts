import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { assertAPIOrigin, pathSegment, requestJSON, toolError } from "./http.js"
import { googleOAuth } from "./oauth.js"

export const docs = {
  pluginID: "google-workspace.docs",
  integrationID: "google-workspace-docs",
  namespace: "docs",
  product: "Google Docs",
  apiOrigin: "https://www.googleapis.com",
  authorizationScopes: ["openid", "email", "https://www.googleapis.com/auth/documents.readonly"],
} as const

const documentIDPattern = /^[A-Za-z0-9_-]+$/
const maxDocumentBytes = 256 * 1024
const maxDocumentChars = 20_000

const DocumentText = Schema.Struct({
  title: Schema.String,
  text: Schema.String,
  truncated: Schema.Boolean,
})

const plugin = Plugin.define({
  id: docs.pluginID,
  async setup(context) {
    await context.integration.transform((editor) => {
      editor.update(docs.integrationID, (integration) => {
        integration.name = docs.product
        integration.connectionPolicy = "member-only"
      })
      editor.method.update(
        googleOAuth(
          {
            integrationID: docs.integrationID,
            product: docs.product,
            authorizationScopes: [...docs.authorizationScopes],
          },
          { register: () => context.integration.oauth.callback.register() },
        ),
      )
    })

    await context.tool.transform((editor) => {
      editor.namespace({ name: docs.namespace, description: "Read Google Docs documents as plain text." })
      editor.add({
        name: "documents_get",
        description: "Read one Google document by ID and return its title with extracted plain text.",
        input: Schema.Struct({
          documentId: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(512),
            Schema.isPattern(documentIDPattern),
          ),
        }),
        output: DocumentText,
        options: { namespace: docs.namespace, permission: "docs_documents_get" },
        execute: async (input, toolContext) => {
          await toolContext.permission({
            action: "docs_documents_get",
            resources: [`docs:document:${input.documentId}`],
          })
          const connection = await context.integration.connection.active(docs.integrationID)
          if (connection === undefined) throw toolError("Connect Google Docs before using this Tool")
          const credential = await context.integration.connection.resolve(connection)
          if (credential?.type !== "oauth" || credential.access === "") throw toolError("Reconnect Google Docs")
          const id = pathSegment(input.documentId, documentIDPattern, 512, "Google Docs document ID is invalid")
          const url = new URL(`/v1/documents/${id}`, docs.apiOrigin)
          assertAPIOrigin(url, docs.apiOrigin, "Google Docs request failed")
          const value = await requestJSON(url, {
            access: credential.access,
            maxBytes: maxDocumentBytes,
            failure: "Google Docs request failed",
          })
          return { output: extractText(value) }
        },
      })
    })
  },
})

/** Extract the title and concatenated text-run content from a Docs JSON response. */
export function extractText(document: unknown): typeof DocumentText.Type {
  const root = (typeof document === "object" && document !== null ? document : {}) as Record<string, unknown>
  const title = typeof root.title === "string" ? root.title : ""
  const parts: string[] = []
  const budget = { size: 0 }
  collectText(root.body, parts, budget)
  return { title, text: parts.join("").slice(0, maxDocumentChars), truncated: budget.size >= maxDocumentChars }
}

function collectText(node: unknown, parts: string[], budget: { size: number }): void {
  if (budget.size >= maxDocumentChars || typeof node !== "object" || node === null) return
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, parts, budget)
    return
  }
  const record = node as Record<string, unknown>
  const textRun = record.textRun
  if (typeof textRun === "object" && textRun !== null) {
    const content = (textRun as Record<string, unknown>).content
    if (typeof content === "string" && content !== "") {
      parts.push(content)
      budget.size += content.length
    }
    return
  }
  for (const value of Object.values(record)) collectText(value, parts, budget)
}

export default plugin
