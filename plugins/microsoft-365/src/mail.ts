import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, graphSend, registerIntegration, requireOAuth, toolError } from "./graph.js"

const MessageID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Top = Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))
const Email = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
)
const Recipients = Schema.Array(Email).check(Schema.isMinLength(1), Schema.isMaxLength(20))
const Subject = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(998))
const Body = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))

const Address = Schema.Struct({ address: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) })
const Message = Schema.Struct({
  id: Schema.String,
  subject: Schema.optionalKey(Schema.String),
  bodyPreview: Schema.optionalKey(Schema.String),
  receivedDateTime: Schema.optionalKey(Schema.String),
  webLink: Schema.optionalKey(Schema.String),
  from: Schema.optionalKey(Schema.Struct({ emailAddress: Schema.optionalKey(Address) })),
})
const MessageListOutput = Schema.Struct({ messages: Schema.Array(Message) })
const SendOutput = Schema.Struct({ sent: Schema.Literal(true) })

const messageSelect = "id,subject,bodyPreview,receivedDateTime,webLink,from"

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
    return Schema.decodeUnknownSync(Schema.Array(Message))(value.value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/** Outlook mail for the signed-in member through delegated Microsoft Graph. */
const plugin = Plugin.define({
  id: "microsoft-365.mail",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "mail", description: "Outlook mail for the signed-in member." })
      editor.add({
        name: "message.list",
        description: "List recent messages, newest first.",
        input: Schema.Struct({ top: Top }),
        output: MessageListOutput,
        options: { namespace: "mail", permission: "mail.message.list" },
        execute: async ({ top }, toolContext) => {
          await toolContext.permission({ action: "mail.message.list", resources: ["mail:inbox"] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({
            $top: String(pageSize(top)),
            $select: messageSelect,
            $orderby: "receivedDateTime desc",
          })
          const value = await graphGet(`/me/messages?${parameters}`, access)
          return { output: { messages: decodeList(value) } }
        },
      })
      editor.add({
        name: "message.get",
        description: "Read one message with its body preview.",
        input: Schema.Struct({ messageID: MessageID }),
        output: Message,
        options: { namespace: "mail", permission: "mail.message.get" },
        execute: async ({ messageID }, toolContext) => {
          await toolContext.permission({ action: "mail.message.get", resources: [`mail:${messageID}`] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $select: messageSelect })
          const value = await graphGet(`/me/messages/${encodeURIComponent(messageID)}?${parameters}`, access)
          try {
            return { output: Schema.decodeUnknownSync(Message)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "message.send",
        description: "Send a message from the signed-in member.",
        input: Schema.Struct({
          to: Recipients,
          subject: Subject,
          body: Body,
          contentType: Schema.optionalKey(Schema.Literals(["Text", "HTML"])),
        }),
        output: SendOutput,
        options: { namespace: "mail", permission: "mail.message.send" },
        execute: async ({ to, subject, body, contentType }, toolContext) => {
          await toolContext.permission({ action: "mail.message.send", resources: [`mail:send:${to[0]}`] })
          const access = await requireOAuth(context)
          await graphSend("/me/sendMail", access, {
            message: {
              subject,
              body: { contentType: contentType ?? "Text", content: body },
              toRecipients: to.map((address) => ({ emailAddress: { address } })),
            },
            saveToSentItems: true,
          })
          return { output: { sent: true as const } }
        },
      })
    })
  },
})

export default plugin
