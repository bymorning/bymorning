import { Effect, Scope } from "effect"
import { ModelError } from "@bymorning/schema/plugin-model"
import { define } from "./plugin.js"

/** Native invocation callbacks acquire resources in their executing Scope. */
export const workspace = define({
  id: "test.workspace",
  scope: "workspace",
  effect: (context) => Effect.gen(function* () {
    yield* context.session.hook("model.invoke", (input) => Effect.gen(function* () {
      const scope = yield* Scope.Scope
      yield* Effect.acquireRelease(Effect.succeed(scope), () => Effect.void)
      input.onUsage(() => Effect.fail(new ModelError({ reason: "budget", message: "Exceeded" })))
      input.onClose(Effect.void)
    }))
    yield* context.gateway.hook("model.request", (input) => Effect.sync(() => { input.model = "routed" }))
    // @ts-expect-error Workspace Plugins have no member-bound Session execution capability.
    void context.session.generate
    // @ts-expect-error Policy is no longer independently managed.
    void context.policy
  }),
})

/** Explicit legacy requirement arguments retain contextual member typing. */
export const member = define<Scope.Scope>({
  id: "test.member",
  effect: (context) => context.session.hook("model.invoke", () => Effect.asVoid(Scope.Scope)).pipe(Effect.asVoid),
})

/** The declaration retains its scope discriminant. */
export const scope: "workspace" = workspace.scope
