export * as Workspace from "./workspace.js"
export * as WorkspaceSchema from "./workspace.js"
import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("wrk_")).pipe(
  Schema.brand("Workspace.ID"),
  statics((schema) => {
    const create = () => schema.make("wrk_" + ascending())
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
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  status: Schema.Literals(["active", "suspended"]),
}).annotate({ identifier: "Workspace.Info" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
