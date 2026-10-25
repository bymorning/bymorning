import * as Provider from "@bymorning/schema/provider"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Schema } from "effect"
import { expect, test } from "vitest"

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
