import { describe, expect, test } from "vitest"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { tags } from "@bymorning/util/effect/app-node"
import { Cipher } from "@bymorning/core/cipher"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Redacted } from "effect"
import { Application } from "./application.js"
import { WebProvider } from "./web-provider.js"
import { WorkspaceMap } from "./workspace-map.js"

const cipherBackend = (fill: number): Cipher.Backend =>
  Effect.runSync(
    Cipher.localBackend(Redacted.make(Buffer.alloc(32, fill).toString("base64url"))).pipe(
      Effect.provide(NodeCrypto.layer),
    ),
  )

describe("server composition", () => {
  test("canonical process declarations compile to a recipe", () => {
    const process = Application.process(
      {
        appOrigin: new URL("https://app.example"),
        cipher: cipherBackend(5),
      },
      {
        identity: WebProvider.configured({
          issuer: new URL("https://issuer.example"),
          clientID: "server-test",
          clientSecret: Redacted.make("secret"),
          provider: Auth.Provider.make("server-test"),
        }),
      },
    )
    expect(() => LayerNode.compile(process.process)).not.toThrow()
  })

  test("canonical Workspace member declarations compile without a Layer cycle", () => {
    const process = Application.process(
      {
        appOrigin: new URL("https://app.example"),
        cipher: cipherBackend(5),
      },
      {
        identity: WebProvider.configured({
          issuer: new URL("https://issuer.example"),
          clientID: "server-test",
          clientSecret: Redacted.make("secret"),
          provider: Auth.Provider.make("server-test"),
        }),
      },
    )
    const owner = {
      workspaceID: Workspace.ID.make("wrk_00000000000000000000000000"),
      accountID: Account.ID.make("acc_00000000000000000000000000"),
      userID: User.ID.make("usr_00000000000000000000000000"),
      role: "admin" as const,
    }
    const key = new WorkspaceMap.RuntimeKey({ workspaceID: owner.workspaceID, accountID: owner.accountID })
    expect(() =>
      LayerNode.compile(
        LayerNode.bind(process.workspaceRuntime.member(owner, key), process.workspaceRuntime.bindings),
        { shared: tags.values.global },
      ),
    ).not.toThrow()
  })
})
