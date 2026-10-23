import { Plugin } from "@bymorning/plugin/effect"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Deferred, Effect, Schedule, Stream } from "effect"

const id = "context7"
const url = "https://mcp.context7.com/mcp"

/** Context7 Integration and remote MCP server plugin. */
export const plugin = Plugin.define({
  id: "context7.mcp",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.integration.transform((editor) => {
        editor.update(id, (integration) => (integration.name = "Context7"))
        editor.method.update({ integrationID: id, method: { type: "key", label: "API key" } })
        editor.method.update({ integrationID: id, method: { type: "env", names: ["CONTEXT7_API_KEY"] } })
      })

      const connectionChanges = context.event.subscribe().pipe(
        Stream.filter((event) => event.type === "integration.connection.updated" && event.data.integrationID === id),
        Stream.retry(Schedule.spaced("1 second")),
        Stream.orDie,
      )
      const refresh = Effect.gen(function* () {
        const connection = yield* context.integration.connection.active(id)
        const credential =
          connection === undefined
            ? undefined
            : yield* context.integration.connection
                .resolve(connection)
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to resolve Context7 connection", { cause }).pipe(Effect.as(undefined)),
                  ),
                )
        return {
          type: "remote",
          url,
          oauth: false,
          ...(credential?.type === "key" && credential.key !== ""
            ? { headers: { Authorization: `Bearer ${credential.key}` } }
            : {}),
        } satisfies ConfigMCP.Remote
      })
      const ready = yield* Deferred.make<void>()
      let server: ConfigMCP.Remote = { type: "remote", url, oauth: false }
      yield* connectionChanges.pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* Deferred.await(ready)
            server = yield* refresh
            yield* context.mcp.reload()
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      server = yield* refresh
      yield* context.mcp.transform((editor) => editor.set(id, server))
      yield* Deferred.succeed(ready, undefined)
    }),
})

export default plugin
