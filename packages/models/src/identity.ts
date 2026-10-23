import { modelAliases } from "../policy/aliases.js"

export function localModelID(provider: string, sourceID: string, apiID: string) {
  if (sourceID !== apiID && modelAliases[`${provider}/${sourceID}`] === undefined) {
    throw new Error(`source key/id disagreement without alias: ${provider}/${sourceID} != ${apiID}`)
  }
  if (provider === "fireworks-ai") {
    // Fireworks API IDs are rooted at accounts/fireworks/{models,routers}/; public IDs omit that routing prefix.
    return sourceID.replace(/^accounts\/fireworks\/(?:models|routers)\//, "")
  }
  return modelAliases[`${provider}/${sourceID}`] ?? sourceID
}

export function assertNoUnapprovedRemovals(
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
  dispositions: ReadonlyArray<string>,
) {
  const removed = previous.filter((id) => !next.includes(id) && !dispositions.includes(id))
  if (removed.length > 0) throw new Error(`removed models require a legacy disposition: ${removed.join(", ")}`)
}
