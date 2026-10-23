import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("declares the integration operations", () => {
  const endpoints: Array<{ identifier: string; method: string; path: string }> = []
  const payloads = new Map<string, Schema.Top>()
  const successes = new Map<string, Schema.Top>()
  const workspaceQueries: string[] = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.integration")
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
      const payload = Array.from(endpoint.payload.values())[0]?.schemas[0]
      if (group.identifier === "api.integration" && payload) payloads.set(endpoint.identifier, payload)
      const success = Array.from(endpoint.success)[0]
      if (group.identifier === "api.integration" && success) successes.set(endpoint.identifier, success)
      if (group.identifier === "api.integration" && endpoint.query) workspaceQueries.push(endpoint.identifier)
    },
  })
  expect(endpoints).toEqual([
    { identifier: "integration.list", method: "GET", path: "/api/integration" },
    { identifier: "integration.get", method: "GET", path: "/api/integration/:integrationID" },
    { identifier: "integration.connect.key", method: "POST", path: "/api/integration/:integrationID/connect/key" },
    {
      identifier: "integration.connect.values",
      method: "POST",
      path: "/api/integration/:integrationID/connect/values",
    },
    {
      identifier: "integration.connect.awsSigV4",
      method: "POST",
      path: "/api/integration/:integrationID/connect/aws-sigv4",
    },
    {
      identifier: "integration.oauth.client.put",
      method: "PUT",
      path: "/api/integration/:integrationID/oauth/:methodID/client",
    },
    {
      identifier: "integration.oauth.client.remove",
      method: "DELETE",
      path: "/api/integration/:integrationID/oauth/:methodID/client",
    },
    {
      identifier: "integration.oauth.connect",
      method: "POST",
      path: "/api/integration/:integrationID/connect/oauth",
    },
    {
      identifier: "integration.oauth.status",
      method: "GET",
      path: "/api/integration/:integrationID/connect/oauth/:attemptID",
    },
    {
      identifier: "integration.oauth.complete",
      method: "POST",
      path: "/api/integration/:integrationID/connect/oauth/:attemptID/complete",
    },
    {
      identifier: "integration.oauth.cancel",
      method: "DELETE",
      path: "/api/integration/:integrationID/connect/oauth/:attemptID",
    },
    {
      identifier: "integration.command.connect",
      method: "POST",
      path: "/api/integration/:integrationID/connect/command",
    },
    {
      identifier: "integration.command.status",
      method: "GET",
      path: "/api/integration/:integrationID/connect/command/:attemptID",
    },
    {
      identifier: "integration.command.cancel",
      method: "DELETE",
      path: "/api/integration/:integrationID/connect/command/:attemptID",
    },
  ])

  const decode = (identifier: string) => {
    const payload = payloads.get(identifier)
    if (!payload) throw new Error(`Missing payload: ${identifier}`)
    return Schema.decodeUnknownSync(Schema.make<Schema.Codec<unknown, unknown>>(payload.ast))
  }
  expect(decode("integration.oauth.connect")({ methodID: "device", answer: { region: "eu" }, label: "Work" })).toEqual({
    methodID: "device",
    answer: { region: "eu" },
    label: "Work",
  })
  expect(decode("integration.oauth.complete")({ code: "answer" })).toEqual({ code: "answer" })
  for (const [identifier, input] of [
    ["integration.connect.key", { key: "key" }],
    ["integration.connect.awsSigV4", { accessKeyId: "access", secretAccessKey: "secret", region: "us-east-1" }],
    ["integration.oauth.connect", { methodID: "oauth" }],
    ["integration.command.connect", { methodID: "command" }],
  ] as const) {
    expect(decode(identifier)({ ...input, scope: "member" })).toEqual({ ...input, scope: "member" })
    expect(decode(identifier)({ ...input, scope: "workspace" })).toEqual({ ...input, scope: "workspace" })
    expect(() => decode(identifier)({ ...input, scope: "another-member" })).toThrow()
  }

  expect(
    decode("integration.connect.awsSigV4")({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "session",
      region: "us-west-2",
      label: "Production",
      methodID: "bedrock-sigv4",
    }),
  ).toEqual({
    accessKeyId: "access",
    secretAccessKey: "secret",
    sessionToken: "session",
    region: "us-west-2",
    label: "Production",
    methodID: "bedrock-sigv4",
  })
  // Commercial and GovCloud regions are admitted; China and ISO partitions are not.
  expect(
    decode("integration.connect.awsSigV4")({
      accessKeyId: "access",
      secretAccessKey: "secret",
      region: "eu-west-1",
    }),
  ).toMatchObject({ region: "eu-west-1" })
  expect(() =>
    decode("integration.connect.awsSigV4")({
      accessKeyId: "access",
      secretAccessKey: "secret",
      region: "cn-north-1",
    }),
  ).toThrow()
  expect(
    decode("integration.connect.key")({ key: "bearer", configuration: { type: "aws-region", region: "us-east-1" } }),
  ).toEqual({ key: "bearer", configuration: { type: "aws-region", region: "us-east-1" } })
  expect(decode("integration.oauth.client.put")({ answer: { client_id: "client" } })).toEqual({
    answer: { client_id: "client" },
  })
  expect(decode("integration.command.connect")({ methodID: "cli", label: "Work" })).toEqual({
    methodID: "cli",
    label: "Work",
  })
  expect(decode("integration.command.connect")({ methodID: "cli", command: ["owned"] })).toEqual({ methodID: "cli" })
  expect(workspaceQueries).toEqual(endpoints.map((endpoint) => endpoint.identifier))

  const decodeSuccess = (identifier: string, value: unknown) => {
    const success = successes.get(identifier)
    if (!success) throw new Error(`Missing success schema: ${identifier}`)
    return Schema.decodeUnknownSync(Schema.make<Schema.Codec<unknown, unknown>>(success.ast))(value)
  }
  expect(
    decodeSuccess("integration.list", [
      {
        id: "amazon-bedrock",
        name: "Amazon Bedrock",
        methods: [
          {
            id: "bedrock-sigv4",
            type: "aws-sigv4",
            label: "AWS credentials",
            region: { key: "region", type: "string", required: true },
          },
          {
            id: "bedrock-sigv4-env",
            type: "env-group",
            authKind: "aws-sigv4",
            available: true,
          },
        ],
        connections: [{ type: "regional-env", authKind: "sigv4", region: "us-west-2" }],
      },
    ]),
  ).toMatchObject([
    {
      methods: [{ type: "aws-sigv4" }, { type: "env-group", authKind: "aws-sigv4", available: true }],
      connections: [{ type: "regional-env", authKind: "sigv4", region: "us-west-2" }],
    },
  ])
  expect(JSON.stringify(decodeSuccess("integration.list", []))).not.toContain("AWS_")
  expect(
    decodeSuccess("integration.oauth.connect", {
      attemptID: "con_oauth",
      url: "https://example.com",
      instructions: "Continue",
      mode: "auto",
      time: { created: 1, expires: 2 },
    }),
  ).toMatchObject({ attemptID: "con_oauth", mode: "auto" })
  expect(
    decodeSuccess("integration.oauth.status", {
      status: "failed",
      message: "raw failure\n",
      time: { created: 1, expires: 2 },
    }),
  ).toEqual({ status: "failed", message: "raw failure\n", time: { created: 1, expires: 2 } })
  expect(
    decodeSuccess("integration.command.status", {
      status: "pending",
      message: "line one\n  line two\n",
      time: { created: 1, expires: 2 },
    }),
  ).toEqual({ status: "pending", message: "line one\n  line two\n", time: { created: 1, expires: 2 } })
  expect(() =>
    decodeSuccess("integration.oauth.status", {
      status: "failed",
      time: { created: 1, expires: 2 },
    }),
  ).toThrow()
})

test("pins OAuth and command OpenAPI operation IDs", () => {
  const paths = OpenApi.fromApi(Api).paths
  const client = paths["/api/integration/{integrationID}/oauth/{methodID}/client"]
  expect(client?.put?.operationId).toBe("v2.integration.oauth.client.put")
  expect(client?.delete?.operationId).toBe("v2.integration.oauth.client.remove")
  expect(client?.get).toBeUndefined()
  expect(paths["/api/integration/oauth/client/plugin"]).toBeUndefined()
  expect(paths["/api/integration/{integrationID}/connect/oauth"]?.post?.operationId).toBe(
    "v2.integration.oauth.connect",
  )
  expect(paths["/api/integration/{integrationID}/connect/oauth/{attemptID}"]?.get?.operationId).toBe(
    "v2.integration.oauth.status",
  )
  expect(paths["/api/integration/{integrationID}/connect/oauth/{attemptID}/complete"]?.post?.operationId).toBe(
    "v2.integration.oauth.complete",
  )
  expect(paths["/api/integration/{integrationID}/connect/oauth/{attemptID}"]?.delete?.operationId).toBe(
    "v2.integration.oauth.cancel",
  )
  expect(paths["/api/integration/{integrationID}/connect/command"]?.post?.operationId).toBe(
    "v2.integration.command.connect",
  )
  expect(paths["/api/integration/{integrationID}/connect/command/{attemptID}"]?.get?.operationId).toBe(
    "v2.integration.command.status",
  )
  expect(paths["/api/integration/{integrationID}/connect/command/{attemptID}"]?.delete?.operationId).toBe(
    "v2.integration.command.cancel",
  )
  for (const operation of [
    client?.put,
    client?.delete,
    paths["/api/integration/{integrationID}/connect/oauth"]?.post,
    paths["/api/integration/{integrationID}/connect/oauth/{attemptID}"]?.get,
    paths["/api/integration/{integrationID}/connect/oauth/{attemptID}/complete"]?.post,
    paths["/api/integration/{integrationID}/connect/oauth/{attemptID}"]?.delete,
    paths["/api/integration/{integrationID}/connect/command"]?.post,
    paths["/api/integration/{integrationID}/connect/command/{attemptID}"]?.get,
    paths["/api/integration/{integrationID}/connect/command/{attemptID}"]?.delete,
  ]) {
    expect(operation?.responses).toHaveProperty("500")
  }
  expect(client?.put?.responses).toHaveProperty("400")
  expect(client?.put?.responses).toHaveProperty("404")
  expect(client?.delete?.responses).toHaveProperty("404")
  expect(paths["/api/integration/{integrationID}/connect/oauth"]?.post?.responses).toHaveProperty("400")
  expect(paths["/api/integration/{integrationID}/connect/oauth/{attemptID}/complete"]?.post?.responses).toHaveProperty(
    "400",
  )
  expect(paths["/api/integration/{integrationID}/connect/command"]?.post?.responses).toHaveProperty("400")
})

test("does not publish AWS credential examples", () => {
  const document = OpenApi.fromApi(Api)
  const operation = document.paths["/api/integration/{integrationID}/connect/aws-sigv4"]?.post
  expect(operation).toBeDefined()
  expect(JSON.stringify(operation)).not.toContain('"example"')
  expect(JSON.stringify(operation)).not.toContain("access-key-id")
  expect(JSON.stringify(operation)).not.toContain("secret-access-key")
  expect(JSON.stringify(document)).not.toMatch(
    /AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|BEARER_TOKEN_BEDROCK|REGION)/,
  )
})

test("reuses canonical Form fields and keeps optional method fields distinct", () => {
  const schemas = OpenApi.fromApi(Api).components.schemas

  expect(schemas["Form.Fields"]).toBeDefined()
  expect(schemas["Integration.MethodFormFields"]).toBeDefined()
  expect(schemas["Integration.OAuthClientConfigurationFields"]).toBeUndefined()
  expect(schemas["Integration.OAuthClientConfiguration"]).toMatchObject({
    properties: { fields: { $ref: "#/components/schemas/Form.Fields" } },
  })
})
