import { expectTypeOf, test, expect } from "vitest"
import * as Solid from "@bymorning/client/solid"
import type { Accessor } from "solid-js"
import type * as SDK from "@bymorning/client"

test("the root is the complete public consumer surface", async () => {
  expect(Object.keys(Solid).sort()).toEqual(["createConnection", "createData"])
  await expect(import("@bymorning/client/solid/" + "internal/client")).rejects.toThrow()
})

test("factories and reactive declarations retain generated SDK contracts", () => {
  expectTypeOf(Solid.createConnection).parameters.toEqualTypeOf<[Solid.ConnectionInput]>()
  expectTypeOf(Solid.createData).parameters.toEqualTypeOf<[Solid.DataInput]>()
  expectTypeOf<Solid.Data["session"]["get"]>().returns.toEqualTypeOf<SDK.SessionDetail | undefined>()
  expectTypeOf<Solid.Data["session"]["message"]["get"]>().returns.toEqualTypeOf<Solid.Message | undefined>()
  expectTypeOf<Solid.Data["session"]["prompt"]>().returns.toEqualTypeOf<Promise<SDK.SessionPromptOutput>>()
  expectTypeOf<Solid.Connection["state"]>().toEqualTypeOf<Accessor<Solid.ConnectionState>>()
})
