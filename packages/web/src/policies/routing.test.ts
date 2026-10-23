import { Provider } from "@bymorning/schema/provider"
import { describe, expect, test } from "vitest"

import type { RoutingRule } from "./rule-dialog"
import { conflictCount, conflicts, insertRoute, isStrictRefinement, overlaps, PlacementError, sameMatcher } from "./routing"

const ref = (id: string, variant?: string) => ({ provider: Provider.Bymorning, id, ...(variant === undefined ? {} : { variant }) })
const model = (from: string, to: string, variant?: string): RoutingRule => ({ match: { model: ref(from, variant) }, to: ref(to) })
const tool = (when: string, to: string): RoutingRule => ({ match: { tool: when }, to: ref(to) })
const combined = (from: string, when: string, to: string, variant?: string): RoutingRule => ({ match: { model: ref(from, variant), tool: when }, to: ref(to) })
const tiers = (default_: string): RoutingRule => ({
  match: { model: { provider: "auto" as typeof Provider.Bymorning, id: "general" } },
  to: {
    tiers: [
      { name: "fast", model: ref("small"), description: "Short questions" },
      { name: "deep", model: ref("large"), description: "Hard work" },
    ],
    default: default_,
    judge: { model: ref("small") },
  },
})

describe("routing precedence", () => {
  test.each([
    ["model and tool", model("a", "x"), tool("jira", "y"), true],
    ["distinct tools", tool("jira", "x"), tool("read", "y"), true],
    ["combined rules with distinct tools", combined("a", "jira", "x"), combined("a", "read", "y"), true],
    ["different models", model("a", "x"), model("b", "y"), false],
    ["combined rules with different models", combined("a", "jira", "x"), combined("b", "jira", "y"), false],
    ["implicit and explicit default variants", model("a", "x"), model("a", "y", "default"), true],
    ["different variants", model("a", "x"), model("a", "y", "thinking"), false],
  ])("detects overlap for %s", (_name, left, right, expected) => {
    expect(overlaps(left, right)).toBe(expected)
  })

  test("compares matchers independently of destinations", () => {
    expect(sameMatcher(combined("a", "jira", "x"), combined("a", "jira", "y"))).toBe(true)
    expect(sameMatcher(model("a", "x"), model("a", "y", "default"))).toBe(true)
    expect(sameMatcher(tool("jira", "x"), tool("read", "x"))).toBe(false)
    expect(conflicts(tool("jira", "x"), tool("read", "x"))).toBe(false)
    expect(conflicts(tool("jira", "x"), tool("read", "y"))).toBe(true)
    expect(conflictCount([model("a", "x"), model("a", "y")])).toBe(1)
  })

  test.each([
    ["matching model", combined("a", "jira", "y"), model("a", "x"), true],
    ["matching tool", combined("a", "jira", "y"), tool("jira", "x"), true],
    ["distinct tool", combined("a", "jira", "y"), tool("read", "x"), false],
    ["distinct model", combined("a", "jira", "y"), model("b", "x"), false],
    ["distinct variant", combined("a", "jira", "y", "thinking"), model("a", "x"), false],
    ["same combined matcher", combined("a", "jira", "y"), combined("a", "jira", "x"), false],
    ["missing model constraint", tool("jira", "y"), model("a", "x"), false],
    ["missing tool constraint", model("a", "y"), tool("jira", "x"), false],
  ])("identifies strict refinement for %s", (_name, candidate, existing, expected) => {
    expect(isStrictRefinement(candidate, existing)).toBe(expected)
  })

  test("places strict refinements after broad rules regardless of destination", () => {
    const broad = model("a", "x")
    const strict = combined("a", "jira", "y")
    expect(isStrictRefinement(strict, broad)).toBe(true)
    expect(insertRoute([broad], strict)).toEqual([broad, strict])
    expect(insertRoute([strict], broad)).toEqual([broad, strict])
    expect(conflictCount([strict, broad])).toBe(1)
    expect(conflictCount([broad, strict])).toBe(0)
  })

  test("applies explicit ambiguous priority", () => {
    const existing = model("a", "x")
    const candidate = tool("jira", "y")
    expect(insertRoute([existing], candidate, "this")).toEqual([existing, candidate])
    expect(insertRoute([existing], candidate, "existing")).toEqual([candidate, existing])
  })

  test("rejects priority that cannot preserve a broad route before its refinement", () => {
    const jira = combined("a", "jira", "x")
    const read = tool("read", "y")
    const broad = model("a", "z")

    expect(() => insertRoute([jira, read], broad, "this")).toThrow(PlacementError)
    expect(insertRoute([read, jira], broad, "this")).toEqual([read, broad, jira])
  })

  test("rejects the symmetric mixed constraint around a new refinement", () => {
    const read = tool("read", "x")
    const broad = model("a", "y")
    const jira = combined("a", "jira", "z")

    expect(() => insertRoute([read, broad], jira, "existing")).toThrow(PlacementError)
    expect(insertRoute([broad, read], jira, "existing")).toEqual([broad, jira, read])
  })

  test("treats distinct accumulated tools as ambiguous when destinations differ", () => {
    const jira = tool("jira", "x")
    const read = tool("read", "y")
    expect(isStrictRefinement(jira, read)).toBe(false)
    expect(isStrictRefinement(read, jira)).toBe(false)
    expect(conflictCount([jira, read])).toBe(1)
    expect(insertRoute([jira], read, "this")).toEqual([jira, read])
    expect(insertRoute([jira], read, "existing")).toEqual([read, jira])
  })

  test("treats disjoint purposes, context ranges, and image conditions as non-overlapping", () => {
    const titles: RoutingRule = { match: { purpose: ["title"] }, to: ref("x") }
    const turns: RoutingRule = { match: { purpose: ["assistant"] }, to: ref("y") }
    const small: RoutingRule = { match: { context: { max: 1_000 } }, to: ref("x") }
    const large: RoutingRule = { match: { context: { min: 2_000 } }, to: ref("y") }
    const images: RoutingRule = { match: { images: true }, to: ref("x") }
    const plain: RoutingRule = { match: { images: false }, to: ref("y") }
    expect(overlaps(titles, turns)).toBe(false)
    expect(overlaps(small, large)).toBe(false)
    expect(overlaps(images, plain)).toBe(false)
    expect(overlaps(titles, small)).toBe(true)
  })

  test("refines by narrower purposes and context ranges", () => {
    const broad: RoutingRule = { match: { purpose: ["assistant", "title"], context: { min: 100 } }, to: ref("x") }
    const narrow: RoutingRule = { match: { purpose: ["assistant"], context: { min: 500, max: 900 } }, to: ref("y") }
    expect(isStrictRefinement(narrow, broad)).toBe(true)
    expect(isStrictRefinement(broad, narrow)).toBe(false)
  })

  test("compares Tier targets by their Tiers, default, and judge", () => {
    expect(conflicts(tiers("fast"), tiers("fast"))).toBe(false)
    expect(conflicts(tiers("fast"), tiers("deep"))).toBe(true)
  })
})
