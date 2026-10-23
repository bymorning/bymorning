import { Workspace } from "@bymorning/core/workspace"
import { ServiceUnavailableError } from "@bymorning/protocol/errors"
import { CurrentAccount } from "@bymorning/protocol/middleware/account-middleware"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Project only active Workspace memberships for the authenticated Account. */
export const WorkspaceHandler = HttpApiBuilder.group(Api, "api.workspace", (handlers) =>
  handlers.handle(
    "workspace.list",
    Effect.fn("WorkspaceHandler.list")(function* () {
      const account = yield* CurrentAccount
      const workspace = yield* Workspace.Service
      return yield* workspace.list(account).pipe(
        Effect.catchTags({
          "Workspace.ReadError": () =>
            Effect.fail(new ServiceUnavailableError({ message: "Workspaces are unavailable" })),
        }),
      )
    }),
  ),
)
