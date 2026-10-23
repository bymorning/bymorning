/** Isolated child: no ambient AWS identity can hide a credential-chain regression. */
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { request } from "@opencode-ai/ai/llm"
import { Integration } from "../../src/integration.js"
import { Credential } from "../../src/credential.js"
import { Bus } from "../../src/bus.js"
import { Model } from "../../src/model.js"
import { ModelResolver } from "../../src/model-resolver.js"
import { Catalog } from "../../src/catalog.js"
import { Provider } from "../../src/provider.js"
import { registry } from "../../src/provider/registry.js"
import * as Process from "../../src/util/process.js"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Form } from "@bymorning/schema/form"
import { packages } from "../../src/catalog/transport.js"

// "container" serves ECS-style credentials; "web-identity" serves a fake local
// STS AssumeRoleWithWebIdentity (Kubernetes projected token, no AWS contact).
const mode = process.env.BEDROCK_CHAIN_MODE ?? "container"
const webIdentityToken = "fixture-projected-service-account-token"
const roleARN = "arn:aws:iam::123456789012:role/fixture-bedrock"

await Effect.runPromise(
  Effect.gen(function* () {
    let generation = 1
    let received = 0
    const server = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof createServer>>((resolve) => {
            const server = createServer((request, response) => {
              received++
              if (mode === "web-identity") {
                let body = ""
                request.on("data", (chunk) => (body += chunk))
                request.on("end", () => {
                  const form = new URLSearchParams(body)
                  assert.equal(request.method, "POST")
                  assert.equal(form.get("Action"), "AssumeRoleWithWebIdentity")
                  assert.equal(form.get("RoleArn"), roleARN)
                  assert.equal(form.get("WebIdentityToken"), webIdentityToken)
                  assert.equal(request.headers.authorization, undefined)
                  response.setHeader("content-type", "text/xml")
                  response.end(
                    `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>metadata-${generation}</AccessKeyId><SecretAccessKey>metadata-secret</SecretAccessKey><SessionToken>token-${generation}</SessionToken><Expiration>${new Date(Date.now() + 3_600_000).toISOString()}</Expiration></Credentials><AssumedRoleUser><AssumedRoleId>AROAFIXTURE:session</AssumedRoleId><Arn>${roleARN}</Arn></AssumedRoleUser></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`,
                  )
                })
                return
              }
              response.setHeader("content-type", "application/json")
              response.end(
                JSON.stringify({
                  AccessKeyId: `metadata-${generation}`,
                  SecretAccessKey: "metadata-secret",
                  Token: `token-${generation}`,
                  Expiration: new Date(Date.now() + 3_600_000).toISOString(),
                }),
              )
            })
            server.listen(0, "127.0.0.1", () => resolve(server))
          }),
      ),
      (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
    const address = server.address()
    assert(address && typeof address === "object")
    if (mode === "web-identity") {
      const file = join(mkdtempSync(join(tmpdir(), "bedrock-web-identity-")), "token")
      writeFileSync(file, webIdentityToken)
      process.env.AWS_ENDPOINT_URL_STS = `http://127.0.0.1:${address.port}`
      process.env.AWS_ROLE_ARN = roleARN
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE = file
    } else process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = `http://127.0.0.1:${address.port}/credentials`
    const dependencies = Layer.mergeAll(
      Layer.mock(Credential.Service, {
        all: () => Effect.succeed([]),
        list: () => Effect.succeed([]),
        client: {
          configured: () => Effect.succeed([]),
          resolve: () => Effect.succeed(Form.Answer.make({})),
          put: () => Effect.void,
          remove: () => Effect.succeed(false),
        },
      }),
      Bus.layer.pipe(Layer.provide(NodeCrypto.layer)),
      LayerNode.compile(Process.node),
    )
    const integrations = yield* Integration.Service.pipe(
      Effect.provide(Integration.layer.pipe(Layer.provide(dependencies))),
    )
    const provider = registry.find((entry) => entry.info.name === "amazon-bedrock")!
    const integrationID = Integration.ID.make("amazon-bedrock")
    yield* integrations.transform((editor) => {
      editor.update(integrationID, (entry) => {
        entry.name = "Amazon Bedrock"
      })
      for (const method of provider.integration.methods)
        if (method.type === "aws-sigv4") editor.method.update({ integrationID, method })
    })
    assert.equal(yield* integrations.connection.active(integrationID), undefined)
    const active = yield* integrations.connection.active(integrationID, { deployment: "allow" })
    assert.deepEqual(active, { type: "regional-deployment", authKind: "sigv4", region: "eu-west-1" })
    const models = yield* Model.Service.pipe(Effect.provide(Model.layer))
    const resolver = yield* ModelResolver.Service.pipe(
      Effect.provide(
        ModelResolver.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Integration.Service, integrations),
              Provider.layer,
              Layer.mock(Catalog.Service, {
                provider: { get: unused, all: unused, available: unused, directory: unused, update: unused },
                model: {
                  get: unused,
                  all: unused,
                  available: unused,
                  visible: unused,
                  requireAvailable: unused,
                  requireExecution: unused,
                  toggle: unused,
                  setDefault: unused,
                  create: unused,
                  update: unused,
                  delete: unused,
                  default: unused,
                },
              }),
            ),
          ),
        ),
      ),
    )
    for (const id of ["amazon.nova-pro-v1:0", "openai.gpt-5.4"]) {
      const selection = yield* models.get({ id, provider: provider.info.name })
      assert(active?.type === "regional-deployment")
      const implementation = packages[selection.package]
      assert(implementation)
      const resolved = yield* resolver.prepare({
        execution: {
          implementation,
          authentication: { type: "key", integration: provider.info.name, header: "authorization", prefix: "Bearer " },
          selection,
          package: selection.package,
          settings: selection.settings,
          routing: {
            type: "aws-bedrock",
            integration: integrationID,
            region: active.region,
            connection: { type: "deployment", authKind: "sigv4" },
          },
        },
        headers: {},
      })
      const canonical = request({ model: resolved.runtimeModel, prompt: "hello" })
      const body = yield* resolved.runtimeModel.route.body.from(canonical)
      const url = id.startsWith("amazon.")
        ? `https://bedrock-runtime.eu-west-1.amazonaws.com/model/${encodeURIComponent(id)}/converse-stream`
        : "https://bedrock-mantle.eu-west-1.api.aws/v1/responses"
      const physical = yield* HttpClientRequest.bodyJson(HttpClientRequest.post(url), body)
      for (const version of [1, 2]) {
        generation = version
        yield* resolved.authentication(physical, (signed) =>
          Effect.sync(() => {
            assert(signed.headers.authorization?.includes(`Credential=metadata-${version}/`))
            assert(
              signed.headers.authorization?.includes(
                `/eu-west-1/${id.startsWith("amazon.") ? "bedrock" : "bedrock-mantle"}/aws4_request`,
              ),
            )
            assert.equal(signed.headers["x-amz-security-token"], `token-${version}`)
            assert(!JSON.stringify(active).includes("metadata-secret"))
            return HttpClientResponse.fromWeb(signed, new Response(null))
          }),
        )
      }
    }
    assert.equal(received, 4)
    console.log("Integration deployment selection and refreshed Converse/Mantle signatures passed")
  }).pipe(Effect.scoped),
)

function unused(): Effect.Effect<never> {
  return Effect.die("Unused Catalog operation")
}
