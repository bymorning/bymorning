/**
 * Commercial Bedrock cross-Region inference profile prefixes. Each names a
 * commercial geography (or the global profile) and none is invocable from an
 * AWS GovCloud (US) Region, whose system-defined profiles are named `us-gov.`.
 */
const commercial = new Set(["us", "global", "eu", "au", "jp", "apac", "ca"])

/**
 * Whether an Amazon Bedrock upstream model ID can be invoked from `region`.
 *
 * - GovCloud (`us-gov-*`): `us-gov.` profiles are allowed; commercial geography
 *   profiles are refused; a bare foundation-model ID is refused when `siblings`
 *   (the Provider's upstream model IDs) contains its `us.` profile, because such
 *   a model is served on demand only through its geography profile, which
 *   GovCloud names `us-gov.`. Any other bare ID is left to AWS.
 * - Commercial Regions: `us-gov.` profiles are refused; everything else is left to AWS.
 */
export const bedrockRegion = (upstream: string, region: string, siblings: ReadonlySet<string>): boolean => {
  const dot = upstream.indexOf(".")
  const prefix = dot === -1 ? undefined : upstream.slice(0, dot)
  if (!region.startsWith("us-gov-")) return prefix !== "us-gov"
  if (prefix === "us-gov") return true
  if (prefix !== undefined && commercial.has(prefix)) return false
  return !siblings.has(`us.${upstream}`)
}
