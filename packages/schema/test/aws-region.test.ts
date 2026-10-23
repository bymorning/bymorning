import { AwsRegion, partitionOf } from "@bymorning/schema/aws-region"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("AwsRegion", () => {
  const decode = Schema.decodeUnknownSync(AwsRegion)

  it.each(["us-east-1", "us-west-2", "eu-west-1", "us-gov-west-1", "us-gov-east-1"])(
    "decodes the commercial or GovCloud region %s",
    (region) => {
      expect(decode(region)).toBe(region)
    },
  )

  it("derives the partition from the region", () => {
    expect(partitionOf(AwsRegion.make("us-east-1"))).toBe("aws")
    expect(partitionOf(AwsRegion.make("us-gov-west-1"))).toBe("aws-us-gov")
  })

  it.each([
    "cn-north-1",
    "us-iso-east-1",
    "us-isob-east-1",
    "us-east-1-fips",
    "fips-us-east-1",
    "US-EAST-1",
    " us-east-1",
    "us-east-1 ",
    "us.east-1",
    "us-east-1:443",
    "https://us-east-1",
    "us-east-1.amazonaws.com",
    "us-east-1/anything",
  ])("rejects an unsupported partition or malformed region %s", (region) => {
    expect(() => decode(region)).toThrow()
  })

  it("constructs and encodes the branded value without transformation", () => {
    const region = AwsRegion.make("us-east-1")

    expect(Schema.encodeSync(AwsRegion)(region)).toBe("us-east-1")
  })
})
