/** Records tool-executed security occurrences (the Share grant lifecycle) for the bound member. */
import { Effect, Layer } from "effect"
import { PluginHooks } from "../plugin/hooks.js"
import type { Audit } from "../audit.js"

/**
 * Tool names mapped to the Audit action their execution performs. The Share
 * plugin's grants live in Plugin KV storage, which shares no transaction with
 * the relational store, so these Entries are post-execution observations
 * rather than fail-closed writes.
 */
const actions = new Map<string, Audit.Action>([
  ["share", "share.create"],
  ["unshare", "share.revoke"],
])

/** Register the Audit recorder on the bound member's Tool hooks. */
export const recorderLayer = (
  audit: Audit.Interface,
  actor: Audit.Principal,
  workspaceID: Audit.Entry["workspaceID"],
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("tool", "execute.after", (event) => {
        const action = actions.get(event.tool)
        if (action === undefined) return Effect.void
        return audit
          .record({
            actor,
            action,
            ...(workspaceID === undefined ? {} : { workspaceID }),
            target: event.sessionID,
            detail: { tool: event.tool },
            outcome: event.status === "completed" ? "success" : "failure",
          })
          .pipe(
            Effect.catchTag("Audit.StoreError", (cause) =>
              Effect.logError("Audit could not record a Share Tool execution", cause),
            ),
          )
      })
    }),
  )
