import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"
import { graphGet, graphWrite, registerIntegration, requireOAuth, toolError } from "./graph.js"

const EventID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
const Top = Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))
const Subject = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))
const DateTime = Schema.String.check(
  Schema.isMinLength(10),
  Schema.isMaxLength(64),
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/),
)
const Email = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
)

const DateTimeZone = Schema.Struct({
  dateTime: Schema.String,
  timeZone: Schema.optionalKey(Schema.String),
})
const Attendee = Schema.Struct({
  emailAddress: Schema.optionalKey(
    Schema.Struct({ address: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) }),
  ),
})
const Event = Schema.Struct({
  id: Schema.String,
  subject: Schema.optionalKey(Schema.String),
  webLink: Schema.optionalKey(Schema.String),
  start: Schema.optionalKey(DateTimeZone),
  end: Schema.optionalKey(DateTimeZone),
  attendees: Schema.optionalKey(Schema.Array(Attendee)),
})
const EventListOutput = Schema.Struct({ events: Schema.Array(Event) })
const CreatedEvent = Schema.Struct({ id: Schema.String, webLink: Schema.optionalKey(Schema.String) })

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
    return Schema.decodeUnknownSync(Schema.Array(Event))(value.value)
  } catch {
    throw toolError("Microsoft Graph returned an invalid response")
  }
}

/** Outlook calendar for the signed-in member through delegated Microsoft Graph. */
const plugin = Plugin.define({
  id: "microsoft-365.calendar",
  async setup(context) {
    await registerIntegration(context)

    await context.tool.transform((editor) => {
      editor.namespace({ name: "calendar", description: "Outlook calendar for the signed-in member." })
      editor.add({
        name: "event.list",
        description: "List upcoming calendar events.",
        input: Schema.Struct({ top: Top }),
        output: EventListOutput,
        options: { namespace: "calendar", permission: "calendar.event.list" },
        execute: async ({ top }, toolContext) => {
          await toolContext.permission({ action: "calendar.event.list", resources: ["calendar:primary"] })
          const access = await requireOAuth(context)
          const parameters = new URLSearchParams({
            $top: String(pageSize(top)),
            $select: "id,subject,webLink,start,end,attendees",
            $orderby: "start/dateTime",
          })
          const value = await graphGet(`/me/calendar/events?${parameters}`, access)
          return { output: { events: decodeList(value) } }
        },
      })
      editor.add({
        name: "event.get",
        description: "Read one calendar event.",
        input: Schema.Struct({ eventID: EventID }),
        output: Event,
        options: { namespace: "calendar", permission: "calendar.event.get" },
        execute: async ({ eventID }, toolContext) => {
          await toolContext.permission({ action: "calendar.event.get", resources: [`event:${eventID}`] })
          const access = await requireOAuth(context)
          const value = await graphGet(`/me/calendar/events/${encodeURIComponent(eventID)}`, access)
          try {
            return { output: Schema.decodeUnknownSync(Event)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
      editor.add({
        name: "event.create",
        description: "Create an event on the signed-in member's calendar.",
        input: Schema.Struct({
          subject: Subject,
          start: DateTime,
          end: DateTime,
          timeZone: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
          attendees: Schema.optionalKey(Schema.Array(Email).check(Schema.isMaxLength(20))),
        }),
        output: CreatedEvent,
        options: { namespace: "calendar", permission: "calendar.event.create" },
        execute: async ({ subject, start, end, timeZone, attendees }, toolContext) => {
          await toolContext.permission({ action: "calendar.event.create", resources: ["calendar:primary"] })
          const access = await requireOAuth(context)
          const zone = timeZone ?? "UTC"
          const value = await graphWrite("/me/calendar/events", access, "POST", {
            subject,
            start: { dateTime: start, timeZone: zone },
            end: { dateTime: end, timeZone: zone },
            ...(attendees === undefined
              ? {}
              : { attendees: attendees.map((address) => ({ emailAddress: { address }, type: "required" })) }),
          })
          try {
            return { output: Schema.decodeUnknownSync(CreatedEvent)(value) }
          } catch {
            throw toolError("Microsoft Graph returned an invalid response")
          }
        },
      })
    })
  },
})

export default plugin
