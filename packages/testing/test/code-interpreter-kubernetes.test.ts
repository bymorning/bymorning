import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { Plugin } from "@bymorning/core/plugin"
import { AccountActor } from "@bymorning/schema/actor"
import { Effect } from "effect"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

const digest = `example.azurecr.us/execution@sha256:${"a".repeat(64)}`
const kubeconfig = () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "k8s-plugin-")), "config")
  // Nothing listens here: activation must not need the cluster, and the startup sweep only logs its failure.
  writeFileSync(
    file,
    JSON.stringify({
      clusters: [{ name: "c", cluster: { server: "http://127.0.0.1:9" } }],
      users: [{ name: "u", user: { token: "t" } }],
      contexts: [{ name: "c", context: { cluster: "c", user: "u" } }],
      "current-context": "c",
    }),
  )
  return file
}

test("loads the Kubernetes implementation as an installation package and refuses an unpinned image", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({
          plugins: [
            {
              package: "@bymorning/plugin-code-interpreter-kubernetes",
              options: { image: digest, kubeconfig: kubeconfig(), runtimeClassName: "kata-vm-isolation" },
            },
          ],
        })
        const owner = yield* app.login()
        const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
        const inventory = yield* app.workspace(
          { account },
          Plugin.Service.use((plugin) => plugin.list()),
        )
        expect(inventory.find((plugin) => plugin.id === "kubernetes")).toMatchObject({
          status: "active",
          source: { type: "package", package: "@bymorning/plugin-code-interpreter-kubernetes" },
          configuration: { title: "Kubernetes Code Interpreter", configured: true },
        })
        const registered = yield* app.workspace(
          { account },
          CodeInterpreter.Service.use((interpreter) => interpreter.list()),
        )
        expect(registered.map((info) => info.id)).toContain("kubernetes")
      }),
    ),
  )
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({
          plugins: [
            {
              package: "@bymorning/plugin-code-interpreter-kubernetes",
              options: { image: "python:3.12-slim", kubeconfig: kubeconfig() },
            },
          ],
        })
        const owner = yield* app.login()
        const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
        const inventory = yield* app.workspace(
          { account },
          Plugin.Service.use((plugin) => plugin.list()),
        )
        expect(inventory.find((plugin) => plugin.id === "kubernetes")?.status).toBe("failed")
        const registered = yield* app.workspace(
          { account },
          CodeInterpreter.Service.use((interpreter) => interpreter.list()),
        )
        expect(registered.map((info) => info.id)).not.toContain("kubernetes")
      }),
    ),
  )
}, 120_000)
