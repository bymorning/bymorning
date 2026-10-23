import { Effect, Layer } from "effect"
import { Integration } from "../../src/integration.js"

const unused = () => Effect.die("Integration mutation is not part of this fixture")

/** No outbound connections for persistence-only Agent and Permission scenarios. */
export const offlineIntegration = Layer.succeed(Integration.Service, {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  transform: unused,
  reload: unused,
  client: { put: unused, remove: unused },
  connection: {
    active: () => Effect.succeed(undefined),
    resolve: () => Effect.succeed(undefined),
    key: unused,
    awsSigV4: unused,
    values: unused,
    activate: unused,
    update: unused,
    remove: unused,
  },
  oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
  command: { connect: unused, status: unused, cancel: unused },
})
