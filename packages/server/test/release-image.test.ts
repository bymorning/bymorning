import { describe, expect, test } from "vitest"
import { releaseImage, releaseImageFor } from "../../../infra/image.js"

const digest = `sha256:${"a".repeat(64)}`
const image = `123456789012.dkr.ecr.us-east-1.amazonaws.com/sst-asset@${digest}`

describe("release image override", () => {
  test("unset or empty keeps the source build", () => {
    expect(releaseImage(undefined)).toBeUndefined()
    expect(releaseImage("")).toBeUndefined()
  })

  test("accepts an ECR digest reference unchanged", () => {
    expect(releaseImage(image)).toBe(image)
  })

  test.each([
    ["a tag", "123456789012.dkr.ecr.us-east-1.amazonaws.com/sst-asset:Gateway"],
    ["a tag beside the digest", `123456789012.dkr.ecr.us-east-1.amazonaws.com/sst-asset:1.0.2@${digest}`],
    ["a short digest", "123456789012.dkr.ecr.us-east-1.amazonaws.com/sst-asset@sha256:abc"],
    ["an uppercase digest", `123456789012.dkr.ecr.us-east-1.amazonaws.com/sst-asset@sha256:${"A".repeat(64)}`],
    ["another registry", `docker.io/library/nginx@${digest}`],
    ["a non-ECR host", `123456789012.dkr.ecr.us-east-1.evil.example/sst-asset@${digest}`],
    ["a bare digest", digest],
    ["surrounding whitespace", ` ${image}`],
  ])("rejects %s", (_name, value) => {
    expect(() => releaseImage(value)).toThrow("BYMORNING_IMAGE")
  })

  test("requires the registry account to be the deployment account", () => {
    expect(releaseImageFor(image, "123456789012")).toBe(image)
    expect(() => releaseImageFor(image, "210987654321")).toThrow("210987654321")
  })
})
