import { describe, expect, it } from "vitest"
import { bedrockRegion } from "../src/catalog/region.js"

const sonnet = "anthropic.claude-sonnet-4-5-20250929-v1:0"
const siblings = new Set([
  sonnet,
  `us.${sonnet}`,
  `global.${sonnet}`,
  `eu.${sonnet}`,
  `us-gov.${sonnet}`,
  "amazon.nova-pro-v1:0",
])

describe("bedrockRegion", () => {
  for (const region of ["us-gov-west-1", "us-gov-east-1"])
    describe(region, () => {
      it("allows us-gov. profiles", () => {
        expect(bedrockRegion(`us-gov.${sonnet}`, region, siblings)).toBe(true)
      })
      it("refuses every commercial geography profile", () => {
        for (const prefix of ["us", "global", "eu", "au", "jp", "apac", "ca"])
          expect(bedrockRegion(`${prefix}.${sonnet}`, region, siblings), prefix).toBe(false)
      })
      it("refuses a bare ID served through a us. profile", () => {
        expect(bedrockRegion(sonnet, region, siblings)).toBe(false)
      })
      it("leaves a bare ID without a us. profile to AWS", () => {
        expect(bedrockRegion("amazon.nova-pro-v1:0", region, siblings)).toBe(true)
        expect(bedrockRegion("custom-model", region, siblings)).toBe(true)
      })
    })

  for (const region of ["us-east-1", "eu-west-1", "ap-northeast-1"])
    describe(region, () => {
      it("refuses us-gov. profiles", () => {
        expect(bedrockRegion(`us-gov.${sonnet}`, region, siblings)).toBe(false)
      })
      it("leaves commercial profiles and bare IDs to AWS", () => {
        for (const upstream of [
          sonnet,
          `us.${sonnet}`,
          `global.${sonnet}`,
          `eu.${sonnet}`,
          `jp.${sonnet}`,
          "amazon.nova-pro-v1:0",
          "custom-model",
        ])
          expect(bedrockRegion(upstream, region, siblings), upstream).toBe(true)
      })
    })
})
