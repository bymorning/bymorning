import { ByMorning } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import { onCleanup } from "solid-js"
import { createQuery } from "../runtime/server/query"

export function directoryFixture() {
  const query = createQuery()
  onCleanup(() => query.clear())
  return {
    query,
    scope: {
      origin: "http://unit.test",
      identity: crypto.randomUUID(),
      workspace: Workspace.ID.create(),
      api: ByMorning.make({ baseUrl: "http://unit.test" }),
    },
  }
}
