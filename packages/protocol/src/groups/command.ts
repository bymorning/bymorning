import { Command } from "@bymorning/schema/command"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InputError, InternalError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Workspace-scoped command catalog contracts. */
export const CommandGroup = HttpApiGroup.make("api.command")
  .add(
    HttpApiEndpoint.get("command.list", "/command", {
      query: WorkspaceQuery,
      success: Schema.Array(Command.Info),
      error: [InputError, InternalError],
    }),
  )
  .prefix("/api")
