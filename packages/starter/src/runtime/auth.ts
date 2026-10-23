import { ByMorning, type ByMorningClient, type WorkspaceAccessInfo } from "@bymorning/client"

/** Browser SDK used only for public authentication and workspace discovery. */
export function browserClient(): ByMorningClient {
  return ByMorning.make({
    baseUrl: window.location.origin,
    fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: "include" }),
  })
}

export async function discoverWorkspace(api: ByMorningClient): Promise<readonly WorkspaceAccessInfo[]> {
  return api.workspace.list()
}

export function loginURL(): string {
  return new URL("/auth/login", window.location.origin).href
}
