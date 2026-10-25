import { Connection } from "@bymorning/schema/connection"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("Integration information supports every copied method and secret-free connection", () => {
  const credentialID = Credential.ID.create()
  const info = Schema.decodeUnknownSync(Integration.Info)({
    id: "exa",
    name: "Exa",
    methods: [
      { type: "key" },
      { type: "env", names: ["EXA_API_KEY"] },
      {
        id: "exa-oauth",
        type: "oauth",
        label: "OAuth",
        client: {
          fields: [{ key: "client_secret", type: "string", secret: true }],
          configured: true,
        },
      },
      { id: "exa-cli", type: "command", label: "CLI", command: ["exa", "auth"] },
    ],
    connections: [
      { type: "credential", id: credentialID, label: "API key", key: "secret" },
      { type: "env", name: "EXA_API_KEY", value: "secret" },
    ],
  })

  expect(Schema.encodeUnknownSync(Schema.toCodecJson(Integration.Info))(info)).toEqual({
    id: "exa",
    name: "Exa",
    methods: [
      { type: "key" },
      { type: "env", names: ["EXA_API_KEY"] },
      {
        id: "exa-oauth",
        type: "oauth",
        label: "OAuth",
        client: {
          fields: [{ key: "client_secret", type: "string", secret: true }],
          configured: true,
        },
      },
      { id: "exa-cli", type: "command", label: "CLI", command: ["exa", "auth"] },
    ],
    connections: [
      { type: "credential", id: credentialID, label: "API key" },
      { type: "env", name: "EXA_API_KEY" },
    ],
  })
  expect(
    Schema.encodeUnknownSync(Schema.toCodecJson(Connection.Info))(
      Schema.decodeUnknownSync(Connection.Info)({
        type: "credential",
        id: credentialID,
        label: "API key",
        key: "secret",
      }),
    ),
  ).toEqual({ type: "credential", id: credentialID, label: "API key" })
  expect(
    Schema.encodeUnknownSync(Schema.toCodecJson(Connection.Info))(
      Schema.decodeUnknownSync(Connection.Info)({ type: "env", name: "EXA_API_KEY", value: "secret" }),
    ),
  ).toEqual({ type: "env", name: "EXA_API_KEY" })
  expect(() => Schema.decodeUnknownSync(Integration.Method)({ type: "oauth", label: "OAuth" })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Integration.Method)({ id: 1, type: "command", label: "CLI", command: ["exa"] }),
  ).toThrow()
})

test("Credential values decode key and OAuth secrets with their optional data", () => {
  const values = [
    {
      type: "key",
      key: "key-secret",
      metadata: { source: "settings" },
      configuration: { region: "eu", retries: 2, enabled: true, scopes: ["read"] },
    },
    {
      type: "oauth",
      methodID: "exa-oauth",
      refresh: "refresh-secret",
      access: "access-secret",
      expires: 1_800_000_000_000,
      metadata: { account: "team" },
    },
  ]

  expect(values.map((value) => Schema.decodeUnknownSync(Credential.Value)(value))).toEqual(values)
})

test("Bedrock credentials have typed regions and retain legacy key compatibility", () => {
  const bearer = {
    type: "key" as const,
    key: "bearer-secret",
    configuration: { type: "aws-region" as const, region: "us-east-1" },
  }
  const sigv4 = {
    type: "aws-sigv4" as const,
    region: "us-west-2",
    accessKeyId: "access-secret",
    secretAccessKey: "key-secret",
    sessionToken: "session-secret",
  }

  expect(Schema.decodeUnknownSync(Credential.AwsBearer)(bearer)).toEqual(bearer)
  expect(Schema.decodeUnknownSync(Credential.Value)(sigv4)).toEqual(sigv4)
  expect(() =>
    Schema.decodeUnknownSync(Credential.AwsBearer)({
      ...bearer,
      configuration: { type: "aws-region", region: "eu-west-1/invalid" },
    }),
  ).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Credential.Value)({
      ...bearer,
      configuration: { type: "aws-region", region: "eu-west-1/invalid" },
    }),
  ).toThrow()
  expect(
    Schema.decodeUnknownSync(Credential.Value)({ type: "key", key: "legacy", configuration: { accountId: "account" } }),
  ).toEqual({ type: "key", key: "legacy", configuration: { accountId: "account" } })
})

test("Bedrock methods have stable unique identities and deterministic environment priority", () => {
  expect(
    new Set([
      Integration.BedrockAwsSigV4MethodID,
      Integration.BedrockBearerEnvMethodID,
      Integration.BedrockSigV4EnvMethodID,
    ]).size,
  ).toBe(3)
  expect(Integration.BedrockEnvMethods).toEqual([
    {
      id: "bedrock-bearer-env",
      type: "env-group",
      authKind: "bedrock-bearer",
      required: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
      optional: [],
    },
    {
      id: "bedrock-sigv4-env",
      type: "env-group",
      authKind: "aws-sigv4",
      required: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
      optional: ["AWS_SESSION_TOKEN"],
    },
  ])
  expect(
    Schema.decodeUnknownSync(Integration.AwsSigV4Method)({
      id: Integration.BedrockAwsSigV4MethodID,
      type: "aws-sigv4",
      label: "AWS credentials",
      region: { key: "region", type: "string", required: true },
    }),
  ).toMatchObject({ id: "bedrock-sigv4", type: "aws-sigv4" })
  expect(() =>
    Schema.decodeUnknownSync(Integration.Methods)([
      Integration.BedrockEnvMethods[0],
      { ...Integration.BedrockEnvMethods[1], id: "bedrock-bearer-env" },
    ]),
  ).toThrow(/Duplicate integration method ID/)
})

test("Integration.Info rejects internal grouped environment variable names", () => {
  const info = Schema.decodeUnknownSync(Integration.Info)({
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    methods: [
      {
        id: Integration.BedrockBearerEnvMethodID,
        type: "env-group",
        authKind: "bedrock-bearer",
        available: false,
        required: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
      },
    ],
    connections: [],
  })
  expect(JSON.stringify(info)).not.toContain("AWS_")
})

test("Bedrock connection projections redact every credential and environment secret", () => {
  const credentialID = Credential.ID.create()
  const connections = [
    {
      type: "regional-credential",
      id: credentialID,
      label: "Amazon Bedrock",
      authKind: "sigv4",
      region: AwsRegion.make("us-east-1"),
      accessKeyId: "access-secret",
      secretAccessKey: "key-secret",
      sessionToken: "session-secret",
    },
    {
      type: "regional-env",
      authKind: "bearer",
      region: AwsRegion.make("us-west-2"),
      names: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
      value: "bearer-secret",
    },
  ]

  expect(
    connections.map((connection) =>
      Schema.encodeUnknownSync(Schema.toCodecJson(Connection.Info))(
        Schema.decodeUnknownSync(Connection.Info)(connection),
      ),
    ),
  ).toEqual([
    {
      type: "regional-credential",
      id: credentialID,
      label: "Amazon Bedrock",
      authKind: "sigv4",
      region: "us-east-1",
    },
    { type: "regional-env", authKind: "bearer", region: "us-west-2" },
  ])
  expect(() => Schema.decodeUnknownSync(Connection.Info)({ type: "regional-env", authKind: "sigv4" })).toThrow()
})
