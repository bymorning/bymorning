import { Plugin } from "@bymorning/plugin"

/** Logs the outcome metadata of each Session tool call without logging its contents. */
export default Plugin.define({
  id: "example.tool-activity",
  async setup(context) {
    await context.tool.hook("execute.after", (event) => {
      // This is a Session tool hook, not an application-wide audit stream. In
      // particular, Tool Gateway calls do not pass through it.
      console.log(
        JSON.stringify({
          event: "bymorning.tool.finished",
          timestamp: new Date().toISOString(),
          sessionID: event.sessionID,
          messageID: event.messageID,
          callID: event.id,
          agent: event.agent,
          tool: event.tool,
          status: event.status,
        }),
      )
    })
  },
})
