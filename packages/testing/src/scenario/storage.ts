/** Filesystem selection and plugin reload through the real Application and SDK. */
export * as StorageScenario from "./storage.js"

import { Plugin } from "@bymorning/core/plugin"
import { Storage } from "@bymorning/core/storage"
import { AccountActor } from "@bymorning/schema/actor"
import { Agent } from "@bymorning/schema/agent"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import type { TestApp } from "../application.js"

/** Local module installed through persisted Config before Workspace activation. */
export const plugin = fileURLToPath(new URL("../storage-plugin.ts", import.meta.url))

/** Reload a real configured plugin and verify that setup read its prior persisted value. */
export const reload = Effect.fn("StorageScenario.reload")(function* (app: TestApp.Interface) {
  const owner = yield* app.login()
  const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
  const selected = yield* app.process(Storage.Service.use((storage) => storage.default()))
  assert.equal(selected.id, "filesystem")
  const inventory = yield* app.workspace({ account }, Plugin.Service.use((plugin) => plugin.list()))
  assert.ok(inventory.some((item) => item.id === "test.storage" && item.status === "active"))
  const before = yield* Effect.tryPromise(() => app.client.agent.list())
  assert.equal(before.find((agent) => agent.id === Agent.DefaultID)?.description, "Storage activation 1")
  const configured = yield* app.workspace(
    { account },
    Plugin.configure(PluginSchema.ID.make("test.storage"), { generation: 2 }),
  )
  assert.equal(configured.status, "active")
  const after = yield* Effect.tryPromise(() => app.client.agent.list())
  assert.equal(after.find((agent) => agent.id === Agent.DefaultID)?.description, "Storage activation 2")
  const value = yield* app.process(
    Storage.Service.use((storage) =>
      storage
        .scope({
          workspaceID: owner.properties.workspaceID,
          pluginID: "test.storage",
        })
        .get("activation"),
    ),
  )
  assert.equal(value, 2)
  return owner
})
