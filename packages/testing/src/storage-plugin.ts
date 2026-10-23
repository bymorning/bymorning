import { Plugin } from "@bymorning/plugin"
import { Agent } from "@bymorning/schema/agent"

/** Observe persistent plugin state through an ordinary SDK-visible Agent contribution. */
export default Plugin.define({
  id: "test.storage",
  configuration: {
    title: "Storage fixture",
    fields: [{ key: "generation", type: "integer", default: 1 }],
  },
  async setup(context) {
    const previous = await context.storage.get("activation")
    if (previous !== undefined && typeof previous !== "number") throw new Error("Invalid stored activation count")
    const activation = (previous ?? 0) + 1
    await context.storage.set("activation", activation)
    await context.agent.transform((editor) => {
      editor.update(Agent.DefaultID, (agent) => {
        agent.description = `Storage activation ${activation}`
      })
    })
  },
})
