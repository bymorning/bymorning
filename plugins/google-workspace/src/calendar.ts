import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { assertAPIOrigin, clampInt, pathSegment, requestJSON, toolError } from "./http.js"
import { googleOAuth } from "./oauth.js"

export const calendar = {
  pluginID: "google-workspace.calendar",
  integrationID: "google-workspace-calendar",
  namespace: "calendar",
  product: "Google Calendar",
  apiOrigin: "https://www.googleapis.com",
  authorizationScopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
} as const

const calendarIDPattern = /^[A-Za-z0-9_.@-]+$/
const eventIDPattern = /^[A-Za-z0-9_-]+$/

const CalendarEntry = Schema.Struct({
  id: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  primary: Schema.optionalKey(Schema.Boolean),
})
const CalendarListResponse = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(CalendarEntry)),
  nextPageToken: Schema.optionalKey(Schema.String),
})
const CalendarEvent = Schema.Struct({
  id: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  htmlLink: Schema.optionalKey(Schema.String),
  start: Schema.optionalKey(Schema.String),
  end: Schema.optionalKey(Schema.String),
})
const EventsListResponse = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  nextPageToken: Schema.optionalKey(Schema.String),
})

const plugin = Plugin.define({
  id: calendar.pluginID,
  async setup(context) {
    await context.integration.transform((editor) => {
      editor.update(calendar.integrationID, (integration) => {
        integration.name = calendar.product
        integration.connectionPolicy = "member-only"
      })
      editor.method.update(
        googleOAuth(
          {
            integrationID: calendar.integrationID,
            product: calendar.product,
            authorizationScopes: [...calendar.authorizationScopes],
          },
          { register: () => context.integration.oauth.callback.register() },
        ),
      )
    })

    await context.tool.transform((editor) => {
      editor.namespace({ name: calendar.namespace, description: "Read Google Calendar calendars and events." })
      editor.add({
        name: "calendars_list",
        description: "List the Google calendars visible to the connected account.",
        input: Schema.Struct({}),
        output: Schema.Struct({ calendars: Schema.Array(CalendarEntry) }),
        options: { namespace: calendar.namespace, permission: "calendar_calendars_list" },
        execute: async (_input, toolContext) => {
          await toolContext.permission({ action: "calendar_calendars_list", resources: ["calendar:calendars"] })
          const access = await calendarAccess(context)
          const url = new URL("/calendar/v3/users/me/calendarList", calendar.apiOrigin)
          assertAPIOrigin(url, calendar.apiOrigin, "Google Calendar request failed")
          url.searchParams.set("fields", "items(id,summary,primary),nextPageToken")
          const value = decode(CalendarListResponse, await calendarJSON(url, access))
          return { output: { calendars: value.items ?? [] } }
        },
      })
      editor.add({
        name: "events_list",
        description: "List events on one Google calendar, optionally bounded by a time range.",
        input: Schema.Struct({
          calendarId: Schema.optionalKey(
            Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256), Schema.isPattern(calendarIDPattern)),
          ),
          timeMin: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
          timeMax: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
          maxResults: Schema.optionalKey(Schema.Number),
          query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
        }),
        output: Schema.Struct({
          events: Schema.Array(CalendarEvent),
          nextPageToken: Schema.optionalKey(Schema.String),
        }),
        options: { namespace: calendar.namespace, permission: "calendar_events_list" },
        execute: async (input, toolContext) => {
          const calendarId = input.calendarId ?? "primary"
          await toolContext.permission({
            action: "calendar_events_list",
            resources: [`calendar:calendar:${calendarId}:events`],
          })
          const access = await calendarAccess(context)
          const segment = pathSegment(calendarId, calendarIDPattern, 256, "Google Calendar ID is invalid")
          const url = new URL(`/calendar/v3/calendars/${segment}/events`, calendar.apiOrigin)
          assertAPIOrigin(url, calendar.apiOrigin, "Google Calendar request failed")
          url.searchParams.set("singleEvents", "true")
          url.searchParams.set("orderBy", "startTime")
          url.searchParams.set("maxResults", String(clampInt(input.maxResults, 1, 100, 20)))
          if (input.timeMin !== undefined) url.searchParams.set("timeMin", input.timeMin)
          if (input.timeMax !== undefined) url.searchParams.set("timeMax", input.timeMax)
          if (input.query !== undefined) url.searchParams.set("q", input.query)
          url.searchParams.set("fields", "items(id,summary,description,start,end,htmlLink),nextPageToken")
          const value = decode(EventsListResponse, await calendarJSON(url, access))
          return {
            output: {
              events: (value.items ?? []).flatMap((item) => {
                const event = toEvent(item)
                return event === undefined ? [] : [event]
              }),
              ...(value.nextPageToken ? { nextPageToken: value.nextPageToken } : {}),
            },
          }
        },
      })
      editor.add({
        name: "events_get",
        description: "Read one Google Calendar event by calendar and event ID.",
        input: Schema.Struct({
          calendarId: Schema.optionalKey(
            Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256), Schema.isPattern(calendarIDPattern)),
          ),
          eventId: Schema.String.check(
            Schema.isMinLength(1),
            Schema.isMaxLength(1024),
            Schema.isPattern(eventIDPattern),
          ),
        }),
        output: CalendarEvent,
        options: { namespace: calendar.namespace, permission: "calendar_events_get" },
        execute: async (input, toolContext) => {
          const calendarId = input.calendarId ?? "primary"
          await toolContext.permission({
            action: "calendar_events_get",
            resources: [`calendar:event:${input.eventId}`],
          })
          const access = await calendarAccess(context)
          const calendarSegment = pathSegment(calendarId, calendarIDPattern, 256, "Google Calendar ID is invalid")
          const eventSegment = pathSegment(input.eventId, eventIDPattern, 1024, "Google Calendar event ID is invalid")
          const url = new URL(`/calendar/v3/calendars/${calendarSegment}/events/${eventSegment}`, calendar.apiOrigin)
          assertAPIOrigin(url, calendar.apiOrigin, "Google Calendar request failed")
          url.searchParams.set("fields", "id,summary,description,start,end,htmlLink")
          const event = toEvent(await calendarJSON(url, access))
          if (event === undefined) throw toolError("Google Calendar returned an invalid response")
          return { output: event }
        },
      })
    })
  },
})

type SetupContext = Parameters<typeof plugin.setup>[0]

async function calendarAccess(context: SetupContext): Promise<string> {
  const connection = await context.integration.connection.active(calendar.integrationID)
  if (connection === undefined) throw toolError("Connect Google Calendar before using this Tool")
  const credential = await context.integration.connection.resolve(connection)
  if (credential?.type !== "oauth" || credential.access === "") throw toolError("Reconnect Google Calendar")
  return credential.access
}

async function calendarJSON(url: URL, access: string): Promise<unknown> {
  return requestJSON(url, { access, failure: "Google Calendar request failed" })
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch {
    throw toolError("Google Calendar returned an invalid response")
  }
}

function toEvent(item: unknown): typeof CalendarEvent.Type | undefined {
  if (typeof item !== "object" || item === null) return undefined
  const record = item as Record<string, unknown>
  if (typeof record.id !== "string" || record.id === "") return undefined
  const event: Record<string, unknown> = { id: record.id }
  if (typeof record.summary === "string") event.summary = record.summary
  if (typeof record.description === "string") event.description = record.description
  if (typeof record.htmlLink === "string") event.htmlLink = record.htmlLink
  const start = eventDate(record.start)
  if (start !== undefined) event.start = start
  const end = eventDate(record.end)
  if (end !== undefined) event.end = end
  try {
    return Schema.decodeUnknownSync(CalendarEvent)(event)
  } catch {
    return undefined
  }
}

function eventDate(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.dateTime === "string" && record.dateTime !== "") return record.dateTime
  if (typeof record.date === "string" && record.date !== "") return record.date
  return undefined
}

export default plugin
