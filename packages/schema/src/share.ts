export * as Share from "./share.js"

import { Schema } from "effect"
import * as Message from "./message.js"
import { Session } from "./session.js"
import { Timestamp } from "./schema.js"
import { Workspace } from "./workspace.js"

export const Token = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Share.Token"))
export type Token = typeof Token.Type

export const Grant = Schema.Struct({
  token: Token,
  createdAt: Timestamp,
})
export interface Grant extends Schema.Schema.Type<typeof Grant> {}

export const Lookup = Schema.Struct({
  sessionID: Session.ID,
})
export interface Lookup extends Schema.Schema.Type<typeof Lookup> {}

export const View = Schema.Struct({
  workspaceID: Workspace.ID,
  sessionID: Session.ID,
  title: Session.Title,
  token: Token,
  createdAt: Timestamp,
  messages: Schema.Array(Message.Message),
}).annotate({ identifier: "Share.View" })
export interface View extends Schema.Schema.Type<typeof View> {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Share.NotFoundError", {
  workspaceID: Workspace.ID,
  token: Token,
}) {}
