import { timestamp } from "drizzle-orm/pg-core"

/** Define a millisecond-precision PostgreSQL timestamp normalized with a time zone. */
export const utc = (name: string) =>
  timestamp(name, {
    mode: "date",
    precision: 3,
    withTimezone: true,
  })

export const timestamps = {
  get timeCreated() {
    return utc("time_created").notNull().defaultNow()
  },
  get timeUpdated() {
    return utc("time_updated")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  get timeDeleted() {
    return utc("time_deleted")
  },
}
