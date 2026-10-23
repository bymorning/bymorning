/** Browser path for a public Share page. */
export const ShareRoutePath = "/s/:workspaceID/:token"

/**
 * Build the public Share href for a Workspace and Token.
 *
 * @param workspaceID - Workspace that owns the grant storage namespace.
 * @param token - Unguessable Share Token.
 */
export function shareRouteHref(workspaceID: string, token: string) {
  return `/s/${encodeURIComponent(workspaceID)}/${encodeURIComponent(token)}`
}
