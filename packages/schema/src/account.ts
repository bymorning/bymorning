export * as Account from "./account.js"
export * as AccountSchema from "./account.js"
import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("acc_")).pipe(
  Schema.brand("Account.ID"),
  statics((schema) => {
    const create = () => schema.make("acc_" + ascending())
    return {
      ascending: (id?: string) => {
        if (!id) return create()
        return schema.make(id)
      },
      create,
    }
  }),
)

export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  status: Schema.Literals(["active", "suspended"]),
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
