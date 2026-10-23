import { Effect, Layer } from "effect"
import { Installation } from "../../src/installation.js"

/** An Installation whose only live capability is the Policy; `policy.value` may be reassigned between snapshots. */
export const installationOf = (policy: { value: Installation.Policy } = { value: Installation.empty }) =>
  Installation.Service.of({
    admin: {
      list: () => Effect.die("unused"),
      grant: () => Effect.die("unused"),
      revoke: () => Effect.die("unused"),
    },
    policy: {
      get: Effect.sync(() => policy.value),
      update: () => Effect.die("unused"),
    },
    check: () => Effect.die("unused"),
    bootstrap: () => Effect.die("unused"),
    arm: Effect.die("unused"),
  })

/** Installation layer with a fixed or mutable Policy. */
export const layer = (policy?: { value: Installation.Policy }) =>
  Layer.succeed(Installation.Service, installationOf(policy))
