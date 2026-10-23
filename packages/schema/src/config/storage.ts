import { Schema } from "effect"

/** Application-wide storage provider selection, applied at startup. */
export const Info = Schema.Struct({ provider: Schema.Literals(["filesystem", "s3"]) })
/** Application-wide storage provider selection, applied at startup. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

export * as ConfigStorage from "./storage.js"
