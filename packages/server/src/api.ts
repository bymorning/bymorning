import { makeApi } from "@bymorning/protocol/api"
import {
  ForbiddenError,
  InvalidRequestError,
  SessionNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@bymorning/protocol/errors"
import { AccountMiddleware, CurrentAccount } from "@bymorning/protocol/middleware/account-middleware"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import type { WorkspaceMap } from "./workspace-map.js"
import { OAuthRawGroup } from "./oauth-api.js"

export { AccountMiddleware }
/** Server runtime implementation key for Workspace selection and capability binding. */
export class WorkspaceMiddleware extends HttpApiMiddleware.Service<
  WorkspaceMiddleware,
  {
    provides: CurrentActor | WorkspaceMap.Capabilities
    requires: CurrentAccount
  }
>()("@bymorning/server/WorkspaceMiddleware", {
  error: [UnauthorizedError, ForbiddenError, InvalidRequestError, ServiceUnavailableError],
}) {}

/** Server runtime implementation key for persisted Session workspace authority. */
export class SessionWorkspaceMiddleware extends HttpApiMiddleware.Service<
  SessionWorkspaceMiddleware,
  {
    provides: CurrentActor | WorkspaceMap.Capabilities
    requires: CurrentAccount
  }
>()("@bymorning/server/SessionWorkspaceMiddleware", {
  error: [UnauthorizedError, ForbiddenError, InvalidRequestError, SessionNotFoundError, ServiceUnavailableError],
}) {}

/** Server-specialized HTTP contract for the browser control plane and health endpoint. */
export class Api extends makeApi(AccountMiddleware, WorkspaceMiddleware, SessionWorkspaceMiddleware)
  .add(OAuthRawGroup) {}
