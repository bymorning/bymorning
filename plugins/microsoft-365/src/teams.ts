import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, registerIntegration, requireOAuth, toolError } from "./graph.js"

const TeamID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const ChannelID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Top = Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))

const Team = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
})
const Channel = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
})
const ChatMessage = Schema.Struct({
  id: Schema.String,
  createdDateTime: Schema.optionalKey(Schema.String),
  webUrl: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(
    Schema.Struct({ contentType: Schema.optionalKey(Schema.String), content: Schema.optionalKey(Schema.String) }),
  ),
  from: Schema.optionalKey(Schema.Unknown),
})
const TeamList = Schema.Struct({ value: Schema.Array(Team) })
const TeamListOutput = Schema.Struct({ teams: Schema.Array(Team) })
const ChannelList = Schema.Struct({ value: Schema.Array(Channel) })
const ChannelListOutput = Schema.Struct({ channels: Schema.Array(Channel) })
const MessageList = Schema.Struct({ value: Schema.Array(ChatMessage) })
const MessageListOutput = Schema.Struct({ messages: Schema.Array(ChatMessage) })

function pageSize(value: number | undefined) {
  const resolved = value ?? 10
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) throw toolError("Invalid page size")
  return resolved
}

function decodeEnvelope<A>(value: unknown, decode: (input: unknown) => A) {
  try {
    return decode(value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/** Microsoft Teams the signed-in member joined, through delegated Microsoft Graph. */
const plugin = Plugin.define({
  id: "microsoft-365.teams",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "teams", description: "Teams joined by the signed-in member." })
      editor.add({
        name: "team.list",
        description: "List teams the signed-in member joined.",
        input: Schema.Struct({}),
        output: TeamListOutput,
        options: { namespace: "teams", permission: "teams.team.list" },
        execute: async (_input, toolContext) => {
          await toolContext.permission({ action: "teams.team.list", resources: ["teams:joined"] })
          const access = await requireOAuth(context)
          const value = await graphGet("/me/joinedTeams?$select=id,displayName", access)
          const decoded = decodeEnvelope(value, (input) => Schema.decodeUnknownSync(TeamList)(input))
          return { output: { teams: decoded.value } }
        },
      })
      editor.add({
        name: "channel.list",
        description: "List channels in one team.",
        input: Schema.Struct({ teamID: TeamID }),
        output: ChannelListOutput,
        options: { namespace: "teams", permission: "teams.channel.list" },
        execute: async ({ teamID }, toolContext) => {
          await toolContext.permission({ action: "teams.channel.list", resources: [`team:${teamID}`] })
          const access = await requireOAuth(context)
          const value = await graphGet(`/teams/${encodeURIComponent(teamID)}/channels`, access)
          const decoded = decodeEnvelope(value, (input) => Schema.decodeUnknownSync(ChannelList)(input))
          return { output: { channels: decoded.value } }
        },
      })
      editor.add({
        name: "message.list",
        description: "List recent messages in one channel.",
        input: Schema.Struct({ teamID: TeamID, channelID: ChannelID, top: Top }),
        output: MessageListOutput,
        options: { namespace: "teams", permission: "teams.message.list" },
        execute: async ({ teamID, channelID, top }, toolContext) => {
          await toolContext.permission({
            action: "teams.message.list",
            resources: [`team:${teamID}`, `channel:${channelID}`],
          })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({ $top: String(pageSize(top)) })
          const value = await graphGet(
            `/teams/${encodeURIComponent(teamID)}/channels/${encodeURIComponent(channelID)}/messages?${parameters}`,
            access,
          )
          const decoded = decodeEnvelope(value, (input) => Schema.decodeUnknownSync(MessageList)(input))
          return { output: { messages: decoded.value } }
        },
      })
    })
  },
})

export default plugin
