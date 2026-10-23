import { Plugin, Tool } from "@bymorning/plugin"
import type { ToolContext } from "@bymorning/plugin/promise/tool"
import { Share } from "@bymorning/schema/share"
import { Schema } from "effect"

/** Plugin identity Core `Share.get` uses to scope grant storage. */
export const id = "bymorning.share"

const Input = Schema.Struct({})
const ShareOutput = Schema.Struct({ url: Schema.String, token: Share.Token })
const UnshareOutput = Schema.Struct({ unshared: Schema.Boolean })

const sessionKey = (sessionID: string) => `session:${sessionID}`
const tokenKey = (token: Share.Token) => `token:${token}`

function toolError(message: string) {
  return new Tool.Error({ message })
}

export default Plugin.define({
  id,
  async setup(context) {
    const withSession = async <A>(toolContext: ToolContext, operation: (sessionID: string) => Promise<A>) => {
      if (toolContext.caller.type !== "session") throw toolError("This Tool requires a Session caller")
      const sessionID = toolContext.caller.sessionID
      await toolContext.permission({ action: "share", resources: [`session:${sessionID}`] })
      try {
        await context.session.get({ sessionID })
      } catch {
        throw toolError("Session not found")
      }
      return operation(sessionID)
    }

    await context.tool.transform((editor) => {
      editor.add({
        name: "share",
        description: "Make this Session readable at a public URL until unshare.",
        options: { permission: "share", codemode: false },
        input: Input,
        output: ShareOutput,
        execute: async (_input, toolContext) =>
          withSession(toolContext, async (sessionID) => {
            const existing = await context.storage.get(sessionKey(sessionID)).catch(() => {
              throw toolError("Unable to read share grant")
            })
            if (existing !== undefined) {
              let grant: Share.Grant
              try {
                grant = Schema.decodeUnknownSync(Share.Grant)(existing)
              } catch {
                throw toolError("Invalid share grant")
              }
              await context.storage.remove(tokenKey(grant.token)).catch(() => {
                throw toolError("Unable to rotate share grant")
              })
            }
            let token: Share.Token
            try {
              token = Schema.decodeUnknownSync(Share.Token)(globalThis.crypto.randomUUID())
            } catch {
              throw toolError("Unable to create share token")
            }
            let grant: Schema.Json
            try {
              grant = Schema.encodeUnknownSync(Share.Grant)({ token, createdAt: new Date() })
            } catch {
              throw toolError("Unable to encode share grant")
            }
            await context.storage.set(sessionKey(sessionID), grant).catch(() => {
              throw toolError("Unable to save share grant")
            })
            await context.storage.set(tokenKey(token), { sessionID }).catch(() => {
              throw toolError("Unable to save share token")
            })
            return { output: { url: `/s/${context.location.workspaceID}/${token}`, token } }
          }),
      })
      editor.add({
        name: "unshare",
        description: "Revoke public access to this Session.",
        options: { permission: "share", codemode: false },
        input: Input,
        output: UnshareOutput,
        execute: async (_input, toolContext) =>
          withSession(toolContext, async (sessionID) => {
            const existing = await context.storage.get(sessionKey(sessionID)).catch(() => {
              throw toolError("Unable to read share grant")
            })
            if (existing === undefined) return { output: { unshared: false } }
            let grant: Share.Grant
            try {
              grant = Schema.decodeUnknownSync(Share.Grant)(existing)
            } catch {
              throw toolError("Invalid share grant")
            }
            await context.storage.remove(tokenKey(grant.token)).catch(() => {
              throw toolError("Unable to remove share token")
            })
            await context.storage.remove(sessionKey(sessionID)).catch(() => {
              throw toolError("Unable to remove share grant")
            })
            return { output: { unshared: true } }
          }),
      })
    })
  },
})
