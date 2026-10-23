export * as Bedrock from "./bedrock.js"

import { AwsRegion } from "@bymorning/schema/aws-region"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import { TestApp } from "../application.js"
import { TestBedrock } from "../bedrock.js"

export const integrationID = Integration.ID.make("amazon-bedrock")
export const region = AwsRegion.make("eu-west-1")
export const model = { converse: "amazon.nova-pro-v1:0", mantle: "openai.gpt-5.4" } as const

/** Deployment identity in place of a saved workspace key, as on ECS with a task role. */
export interface Deployment {
  /** AWS_REGION of the deployment. */
  readonly region: AwsRegion
  /** AWS_USE_FIPS_ENDPOINT=true. */
  readonly fips?: boolean
}

export interface Options extends Pick<TestApp.Input, "plugins"> {
  readonly deployment?: Deployment
  /** Bedrock Models to enable; defaults to `model`. */
  readonly models?: ReadonlyArray<string>
}

/**
 * Process environment read by the AWS SDK default credential chain and by Core's
 * FIPS endpoint selection, restored when the scope closes.
 */
const environment = (values: Readonly<Record<string, string>>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      Object.assign(process.env, values)
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

/** Real SDK connection setup and a key authorized through the normal middleware. */
export const make = Effect.fn("Bedrock.make")(function* (options: Options = {}) {
  const upstream = yield* TestBedrock.make()
  const { deployment: chain } = options
  if (chain)
    yield* environment({
      AWS_ACCESS_KEY_ID: "fixture-workspace",
      AWS_SECRET_ACCESS_KEY: "fixture-secret",
      AWS_SESSION_TOKEN: "fixture-token",
      AWS_USE_FIPS_ENDPOINT: chain.fips === true ? "true" : "false",
    })
  const app = yield* TestApp.make({
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    outbound: upstream.outbound,
    ...(chain ? { config: { AWS_REGION: chain.region } } : {}),
  })
  const owner = yield* app.login()
  const deployment = yield* Effect.tryPromise(() => app.client.integration.get({ integrationID }))
  if (chain)
    yield* Effect.tryPromise(() => app.client.provider.update({ provider: Provider.AmazonBedrock, status: "enabled" }))
  else
    yield* Effect.tryPromise(() =>
      app.client.integration.connect.awsSigV4({
        integrationID,
        scope: "workspace",
        region,
        accessKeyId: "fixture-workspace",
        secretAccessKey: "fixture-secret",
        sessionToken: "fixture-token",
      }),
    )
  for (const id of options.models ?? Object.values(model))
    yield* Effect.tryPromise(() => app.client.model.toggle({ provider: Provider.AmazonBedrock, id, enabled: true }))
  const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Bedrock fixture" }))
  const key = yield* Effect.tryPromise(() =>
    app.client.serviceAccount.key.create({ id: account.id, name: "Inference" }),
  )
  const headers = { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }
  return { app, upstream, owner, deployment, headers }
})
