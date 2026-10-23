import { models } from "@bymorning/models/generated/amazon-bedrock"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { Model } from "../src/model.js"
import { Provider } from "@bymorning/schema/provider"
import { AwsRegion } from "@bymorning/schema/aws-region"

describe("Bedrock executable bindings", () => {
  it("admits every catalogued language candidate and inherits the native transport package", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Model.Service
        const candidates = models.filter(
          (model) =>
            model.lifecycle !== "deprecated" &&
            model.metadata.capabilities.input.includes("text") &&
            model.metadata.capabilities.output.includes("text"),
        )
        expect(candidates.length).toBeGreaterThan(100)
        for (const candidate of candidates) {
          const selection = yield* service.get({ provider: Provider.AmazonBedrock, id: candidate.local.id })
          expect(selection.info.apiID).toBe(candidate.apiID)
          expect(selection.package).toBe(
            candidate.transport === "mantle-responses"
              ? "@opencode-ai/ai/providers/amazon-bedrock/mantle"
              : "@opencode-ai/ai/providers/amazon-bedrock",
          )
        }
      }).pipe(Effect.provide(Model.layer)),
    )
  })

  it("constructs commercial and GovCloud regional endpoints without a region approval list", () => {
    for (const region of ["eu-west-1", "us-east-2", "ap-southeast-5", "us-gov-west-1"])
      expect(Provider.bedrockRuntimeAPI(AwsRegion.make(region))).toBe(`https://bedrock-runtime.${region}.amazonaws.com`)
    for (const region of ["us-east-1/evil", "cn-north-1", "us-iso-east-1", "us-east-1.attacker.test"])
      expect(() => AwsRegion.make(region)).toThrow()
  })
})
