import * as Provider from "@bymorning/schema/provider"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Integration } from "@bymorning/schema/integration"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("Provider information describes the code-backed Bymorning endpoint", () => {
  const provider = Schema.decodeUnknownSync(Provider.Info)({
    name: "bymorning",
    displayName: "Bymorning",
    api: "https://bymorning.ai/gateway/v1",
    format: "oa-compat",
    status: "enabled",
  })

  expect(provider.name).toBe(Provider.Bymorning)
  expect(Provider.Bymorning).toBe("bymorning")
  expect(Provider).not.toHaveProperty("ID")
  expect(Provider.Info.fields).not.toHaveProperty("id")
  expect(Object.keys(provider)).not.toContain("credential")
  const { displayName: _, ...withoutDisplayName } = provider
  expect(Schema.decodeUnknownSync(Provider.Info)(withoutDisplayName).displayName).toBeUndefined()
  expect(Schema.decodeUnknownSync(Provider.Name)("ByMorning")).toBe("ByMorning")
  expect(Schema.decodeUnknownSync(Provider.Name)("PRV_bymorning")).toBe("PRV_bymorning")
  expect(() => Schema.decodeUnknownSync(Provider.Name)("prv_bymorning")).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Provider.Info, { onExcessProperty: "error" })({
      id: "prv_bymorning",
      ...provider,
    }),
  ).toThrow()
})

test("Provider directory entries carry management state without credentials", () => {
  const info = Provider.Info.make({
    name: Provider.OpenAI,
    displayName: "OpenAI",
    api: Provider.API.make("https://api.openai.com/v1"),
    format: "openai",
    status: "enabled",
  })
  const entry = Schema.decodeUnknownSync(Provider.DirectoryEntry)({
    info,
    integration: Integration.Info.make({
      id: Integration.ID.make("openai"),
      name: "OpenAI",
      methods: [{ type: "key" }],
      connections: [],
    }),
    active: false,
    connected: false,
    connectionCount: 0,
    modelCount: 2,
  })

  expect(entry).toMatchObject({ info, active: false, connected: false, connectionCount: 0, modelCount: 2 })
  expect(entry.integration).not.toHaveProperty("credential")
})

test("Bedrock uses an approved regional endpoint strategy without projecting a fake API", () => {
  const info = Schema.decodeUnknownSync(Provider.Info)({
    name: "amazon-bedrock",
    displayName: "Amazon Bedrock",
    format: "bedrock-converse",
    status: "enabled",
  })

  expect(info).toEqual({
    name: Provider.AmazonBedrock,
    displayName: "Amazon Bedrock",
    format: "bedrock-converse",
    status: "enabled",
  })
  expect(Provider.bedrockRuntimeAPI(AwsRegion.make("us-east-1"))).toBe(
    "https://bedrock-runtime.us-east-1.amazonaws.com",
  )
  expect(
    Schema.decodeUnknownSync(Provider.EndpointStrategy)({ _tag: "aws-regional", partitions: ["aws", "aws-us-gov"] }),
  ).toEqual({
    _tag: "aws-regional",
    partitions: ["aws", "aws-us-gov"],
  })
  expect(Provider.bedrockRuntimeAPI(AwsRegion.make("us-gov-west-1"))).toBe(
    "https://bedrock-runtime.us-gov-west-1.amazonaws.com",
  )
  // The FIPS-designated variant shares the hostname shape and the amazonaws.com
  // suffix in both partitions.
  expect(Provider.bedrockRuntimeAPI(AwsRegion.make("us-east-1"), { fips: true })).toBe(
    "https://bedrock-runtime-fips.us-east-1.amazonaws.com",
  )
  expect(Provider.bedrockRuntimeAPI(AwsRegion.make("us-gov-west-1"), { fips: true })).toBe(
    "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
  )
  expect(Provider.bedrockRuntimeAPI(AwsRegion.make("us-east-1"), { fips: false })).toBe(
    "https://bedrock-runtime.us-east-1.amazonaws.com",
  )
  expect(() => Schema.decodeUnknownSync(Provider.EndpointStrategy)({ _tag: "aws-regional", partitions: [] })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Provider.EndpointStrategy)({ _tag: "aws-regional", partitions: ["aws-cn"] }),
  ).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Provider.EndpointStrategy)(
      {
        _tag: "aws-regional",
        partitions: ["aws"],
        api: "https://example.com",
      },
      { onExcessProperty: "error" },
    ),
  ).toThrow()
})
