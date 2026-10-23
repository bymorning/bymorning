import { Plugin } from "@bymorning/plugin"
import { Schema } from "effect"

/** A member-host sentinel: cold Gateway activation must never run this setup. */
export default Plugin.define({
  id: "test.member",
  async setup(context) {
    const endpoint = Schema.decodeUnknownSync(Schema.String)(context.options.endpoint)
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "member", generation: 1, workspaceID: context.location.workspaceID }),
    })
    if (!response.ok) throw new Error("Plugin observer rejected member activation")
  },
})
