/**
 * The image's serving composition: both cloud backends and the
 * fail-closed process identity. Loaded by index.ts only on the
 * serve path so `migrate` never evaluates a cloud SDK.
 */
import { Effect } from "effect"
import { Application } from "../../../packages/server/src/application.js"
import { kms, s3 } from "./aws.js"
import { blob, keyvault } from "./azure.js"
import { Host } from "./host.js"

/** What the image offers a deployment; the installer's variables pick from these. */
export const selection = {
  storage: { s3, "azure-blob": blob },
  cipher: { kms, keyvault },
  identity: Host.identity,
} satisfies Host.Selection

/** Resolve the deployment and serve the Gateway until the process ends. */
export const program = Effect.flatMap(Host.resolve(selection), (input) =>
  Application.serve(Application.node(input), input.settings),
)
