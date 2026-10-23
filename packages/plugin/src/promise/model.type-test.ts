import { define } from "./plugin.js"
import { ModelError } from "@bymorning/schema/plugin-model"

/** Workspace Plugins receive invocation facts but no member capabilities. */
export const workspace = define({
  id: "test.workspace",
  scope: "workspace",
  async setup(context) {
    await context.gateway.hook("model.invoke", (input) => {
      const signal: AbortSignal = input.signal
      input.onClose(() => { void signal.aborted })
      input.onUsage((tokens) => {
        const total = tokens.input + tokens.output
        if (total > 100) return new ModelError({ reason: "rate", message: "Rate exceeded" })
      })
      // @ts-expect-error Final selection is immutable.
      input.publicModel = "other"
      // @ts-expect-error Gateway inference carries no member identity.
      void input.userID
    })
    await context.session.hook("model.invoke", (input) => {
      const purpose: "assistant" | "generate" | "compaction" | "title" | "route" = input.purpose
      void purpose
    })
    await context.gateway.hook("model.request", (input) => {
      input.model = "routed"
      // @ts-expect-error Protocol cannot change during native request customization.
      input.protocol = "openai-chat"
    })
    // @ts-expect-error Workspace Plugins cannot start member-bound inference.
    void context.session.generate
    // @ts-expect-error Policy is supplied through hooks, not an independently managed record.
    void context.policy
    // @ts-expect-error Workspace Plugins have no member identity.
    void context.location.userID
  },
})

/** The declaration retains its scope discriminant. */
export const scope: "workspace" = workspace.scope
