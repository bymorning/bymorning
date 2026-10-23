import { Config } from "@bymorning/schema/config"
import { Installation } from "@bymorning/schema/installation"

/** The Share Plugin's package name and durable identity spellings. */
const sharePlugin = (candidate: string) =>
  candidate === "@bymorning/plugin-share" ||
  candidate === "bymorning.share" ||
  /(?:^|\/)plugins\/share$/.test(candidate)

const pluginPackage = (entry: NonNullable<Config.Info["plugins"]>[number]) =>
  typeof entry === "string" ? entry : entry.package

/**
 * Apply the Installation Policy lock to a resolved Workspace Config: a locked
 * capability is a mandatory installation restriction, so the Workspace view is
 * clamped — never loosened — before any consumer reads it.
 */
export const applyLock = (info: Config.Info, policy: Installation.Policy): Config.Info => {
  const allow = policy.providers?.allow
  const providers =
    allow === undefined
      ? info.providers
      : {
          ...info.providers,
          allow:
            info.providers?.allow === undefined
              ? [...allow]
              : info.providers.allow.filter((name) => allow.includes(name)),
        }
  const pluginPolicy = policy.plugins
  let plugins = info.plugins
  if (pluginPolicy !== undefined) {
    const listed = info.plugins ?? []
    plugins = pluginPolicy === "off" ? [] : listed.filter((entry) => pluginPolicy.allow.includes(pluginPackage(entry)))
  }
  if (policy.share === "off") plugins = (plugins ?? []).filter((entry) => !sharePlugin(pluginPackage(entry)))
  const websearch = policy.websearch === "off" ? (false as const) : info.websearch
  return {
    ...info,
    ...(providers === undefined ? {} : { providers }),
    ...(plugins === undefined ? {} : { plugins }),
    ...(websearch === undefined ? {} : { websearch }),
  }
}
