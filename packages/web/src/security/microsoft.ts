/** Microsoft Entra ID clouds; the issuer differs only by authority host. */
export type MicrosoftCloud = "commercial" | "government"

export const microsoftClouds: ReadonlyArray<MicrosoftCloud> = ["commercial", "government"]

export const microsoftCloudLabels: Record<MicrosoftCloud, string> = {
  commercial: "Commercial (login.microsoftonline.com)",
  government: "Azure Government (login.microsoftonline.us)",
}

const authorities: Record<MicrosoftCloud, string> = {
  commercial: "login.microsoftonline.com",
  government: "login.microsoftonline.us",
}

export function microsoftTenantIssuer(cloud: MicrosoftCloud, tenantID: string) {
  return `https://${authorities[cloud]}/${encodeURIComponent(tenantID.trim())}/v2.0`
}

/** Parse a canonical v2.0 Entra issuer; an empty tenant means it is not canonical. */
export function parseMicrosoftIssuer(
  issuer: string,
): { readonly cloud: MicrosoftCloud; readonly tenantID: string } | undefined {
  try {
    const url = new URL(issuer)
    const match = url.pathname.match(/^\/([^/]+)\/v2\.0\/?$/)
    const cloud = microsoftClouds.find((candidate) => authorities[candidate] === url.hostname)
    if (url.protocol !== "https:" || !cloud || url.search || url.hash || !match?.[1]) return undefined
    return { cloud, tenantID: decodeURIComponent(match[1]) }
  } catch {
    return undefined
  }
}
