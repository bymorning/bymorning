/**
 * The image's serving composition: both cloud backends and the
 * fail-closed process identity, or — only when the operator sets
 * BYMORNING_EVALUATION=true — the evaluation selection. Loaded by index.ts
 * only on the serve path so `migrate` never evaluates a cloud SDK.
 */
import { Auth } from "@bymorning/schema/auth"
import { Config, Effect, Option } from "effect"
import { Application } from "../../../packages/server/src/application.js"
import { LocalWebProvider } from "../../../packages/server/src/application/adapters/identity-local.js"
import { kms, s3 } from "./aws.js"
import { blob, keyvault } from "./azure.js"
import { Host } from "./host.js"
import { filesystem, supplied } from "./local.js"

/** What the image offers a deployment; the installer's variables pick from these. */
export const selection = {
  storage: { s3, "azure-blob": blob },
  cipher: { kms, keyvault },
  identity: Host.identity,
} satisfies Host.Selection

/** The fixed identity Local Login signs in on an evaluation installation's loopback origin. */
export const identity = {
  subject: Auth.Sub.make("evaluator"),
  email: Auth.Email.make("evaluator@local.test"),
}

/**
 * The evaluation selection: the production table plus filesystem storage, the
 * local cipher keyed by the operator-supplied CIPHER_KEY (never generated), and
 * Local Login on a loopback APP_ORIGIN. Nothing is defaulted.
 */
export const evaluation = {
  storage: { ...selection.storage, filesystem },
  cipher: { ...selection.cipher, local: supplied },
  identity: LocalWebProvider.node(identity),
  local: identity,
  evaluation: true,
} satisfies Host.Selection

/** BYMORNING_EVALUATION is exactly "true" or "false"; unset is "false". */
export const choose = Effect.gen(function* () {
  const value = Option.getOrElse(yield* Config.option(Config.string("BYMORNING_EVALUATION")), () => "false")
  if (value === "true") return evaluation
  if (value === "false") return selection
  return yield* new Host.ConfigError({ setting: "BYMORNING_EVALUATION", reason: 'must be "true" or "false"' })
})

/** Resolve the deployment and serve the Gateway until the process ends. */
export const program = choose.pipe(
  Effect.flatMap((chosen) => Host.resolve<never>(chosen)),
  Effect.flatMap((input) => Application.serve(Application.node(input), input.settings)),
)
