export * as PluginUpdate from "./update.js"

import { Effect } from "effect"
import { PluginUpdate } from "../plugin-update.js"
import { Service } from "../plugin.js"
import { InvalidError } from "./configuration.js"
import { PluginSupervisor } from "./supervisor-service.js"

/** Check one configured package source and project its update status into this Workspace inventory. */
export const check = Effect.fn("PluginUpdate.check")(function* (target: string) {
  yield* packageTarget(target)
  const updates = yield* PluginUpdate.Service
  const supervisor = yield* PluginSupervisor.Service
  yield* updates.check(target)
  yield* supervisor.reload
  return yield* Service.use((plugins) => plugins.list())
})

/** Update one configured package source and reload this Workspace inventory from the installed revision. */
export const update = Effect.fn("PluginUpdate.update")(function* (target: string) {
  yield* packageTarget(target)
  const updates = yield* PluginUpdate.Service
  const supervisor = yield* PluginSupervisor.Service
  yield* supervisor.reloadAfter(updates.update(target))
  return yield* Service.use((plugins) => plugins.list())
})

const packageTarget = Effect.fn("PluginUpdate.packageTarget")(function* (target: string) {
  const plugins = yield* Service
  const present = (yield* plugins.list()).some((plugin) => plugin.source.type === "package" && plugin.source.package === target)
  if (!present) return yield* new InvalidError({ message: `Plugin package is not in the Workspace inventory: ${target}` })
})
