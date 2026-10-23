import * as Share from "@bymorning/schema/share"
import { Workspace } from "@bymorning/schema/workspace"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InputError, InternalError, ShareNotFoundError } from "../errors.js"

/** Public Share HTTP endpoints. */
export const ShareGroup = HttpApiGroup.make("server.share").add(
  HttpApiEndpoint.get("share.get", "/api/public/share/:workspaceID/:token", {
    params: { workspaceID: Workspace.ID, token: Share.Token },
    success: Share.View,
    error: [InputError, ShareNotFoundError, InternalError],
  }),
)
