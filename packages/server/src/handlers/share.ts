import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Share } from "@bymorning/core/share"
import { ShareNotFoundError } from "@bymorning/protocol/errors"
import { Api } from "../api.js"

/** Public Share endpoint implementations. */
export const ShareHandler = HttpApiBuilder.group(Api, "server.share", (handlers) =>
  handlers.handle("share.get", ({ params }) =>
    Share.Service.use((share) =>
      share.get({ workspaceID: params.workspaceID, token: params.token }).pipe(
        Effect.catchTag(
          "Share.NotFoundError",
          (error) =>
            new ShareNotFoundError({
              workspaceID: error.workspaceID,
              token: error.token,
              message: "Share not found",
            }),
        ),
      ),
    ),
  ),
)
