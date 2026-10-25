import { describe, expect, it } from "@effect/vitest"
import { Model } from "@bymorning/schema/model"
import { Plugin } from "@bymorning/schema/plugin"
import * as PolicySchema from "@bymorning/schema/policy"
import { Provider } from "@bymorning/schema/provider"
import { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Cause, Effect, Exit } from "effect"
import { Policy } from "../src/policy.js"

const source = PolicySchema.Source.make({
  type: "plugin",
  pluginID: Plugin.ID.make("policy-test"),
  pluginSource: { type: "sdk" },
})
const projectID = Project.ID.make("prj_00000000000000000000000001")

describe("Policy", () => {
  it.effect("keeps IDs globally unique while transforms are active and disposes them with scope", () =>
    Effect.gen(function* () {
      const policies = yield* Policy.Service
      const exit = yield* Effect.scoped(
        policies
          .transform((editor) => editor.add(info({ id: "one", name: "One", enabled: true, rules: [] })))
          .pipe(
            Effect.andThen(
              policies.transform((editor) =>
                editor.add(info({ id: "one", name: "Duplicate", enabled: true, rules: [] })),
              ),
            ),
            Effect.exit,
          ),
      )
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(yield* policies.list).toEqual([])
    }).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("rejects collisions within one transform", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policies = yield* Policy.Service
        const exit = yield* policies.transform((editor) => {
            editor.add(info({ id: "duplicate", name: "First", enabled: true, rules: [] }))
            editor.add(info({ id: "duplicate", name: "Second", enabled: true, rules: [] }))
          }).pipe(Effect.exit)
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      }),
    ).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("lists complete immutable info and evaluates project policies across the Workspace", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policies = yield* Policy.Service
        const rule = { type: "guardrail" as const, action: "tool.execute", resource: "shell", effect: "deny" as const }
        yield* policies.transform((editor) =>
          editor.add({
            id: "project",
            name: "Project",
            description: "Local",
            enabled: true,
            rules: [rule],
            source: PolicySchema.Source.make({
              type: "plugin",
              pluginID: Plugin.ID.make("project-policy"),
              pluginSource: { type: "project", projectID, path: ProjectDirectory.Path.make("plugin/policies.ts") },
            }),
          }),
        )
        expect(yield* policies.list).toEqual([expect.objectContaining({ id: "project", rules: [rule] })])
        expect((yield* policies.list)[0]).not.toHaveProperty("editable")
        expect((yield* policies.evaluate("tool.execute", "shell")).guardrail.effect).toBe("deny")
      }),
    ).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("selects enabled rules of one kind in transform order with provenance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policies = yield* Policy.Service
        const redact = (replacement: string) =>
          ({ type: "tool.output", tool: "*", match: { pattern: "sk-[a-z]+" }, replacement }) as const
        yield* policies.transform((editor) => {
          editor.add(
            info({
              id: "first",
              name: "First",
              enabled: true,
              rules: [
                { type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny" },
                redact("[one]"),
              ],
            }),
          )
          editor.add(info({ id: "disabled", name: "Disabled", enabled: false, rules: [redact("[skipped]")] }))
          editor.add(info({ id: "second", name: "Second", enabled: true, rules: [redact("[two]")] }))
        })
        expect(yield* policies.select("tool.output")).toEqual([
          { policyID: "first", rule: 1, definition: redact("[one]") },
          { policyID: "second", rule: 0, definition: redact("[two]") },
        ])
        expect(yield* policies.select("prompt")).toEqual([])
        // Non action/resource kinds never participate in evaluate traces.
        expect((yield* policies.evaluate("tool.execute", "shell")).trace).toEqual([
          { policyID: "first", rule: 0, type: "guardrail", matched: true, selected: true },
        ])
      }),
    ).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("remove tombstones an ID regardless of transform order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policies = yield* Policy.Service
        const removal = yield* policies.transform((editor) => editor.remove("routed"))
        yield* policies.transform((editor) =>
          editor.add(
            info({
              id: "routed",
              name: "Routed",
              enabled: true,
              rules: [{ type: "route", action: "model.request", resource: "*", target: "acme/safe" }],
            }),
          ),
        )
        expect(yield* policies.list).toEqual([expect.objectContaining({ id: "routed", suppressed: true })])
        expect((yield* policies.evaluate("model.request", "openai/gpt-5")).route).toBeUndefined()
        yield* removal.dispose
        expect((yield* policies.list).map((policy) => policy.id)).toEqual(["routed"])
        expect((yield* policies.evaluate("model.request", "openai/gpt-5")).route).toBe("acme/safe")
      }),
    ).pipe(Effect.provide(Policy.layer)),
  )

  it.effect("remove of an unknown ID is a no-op and the editor lists active policies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const policies = yield* Policy.Service
        let seen: ReadonlyArray<string> = []
        yield* policies.transform((editor) => editor.add(info({ id: "kept", name: "Kept", enabled: true, rules: [] })))
        yield* policies.transform((editor) => {
          editor.remove("missing")
          seen = editor.list().map((policy) => policy.id)
        })
        expect(seen).toEqual(["kept"])
        expect((yield* policies.list).map((policy) => policy.id)).toEqual(["kept"])
      }),
    ).pipe(Effect.provide(Policy.layer)),
  )
})

function info(policy: PolicySchema.Policy): PolicySchema.Info {
  return { ...policy, source, managed: false, suppressed: false }
}

describe("Policy.Resource", () => {
  const model = Model.Ref.make({ provider: Provider.OpenAI, id: "gpt-5", variant: "fast" })

  it("formats and parses normalized model references", () => {
    expect(Policy.Resource.model(model)).toBe("openai/gpt-5#fast")
    expect(Policy.Resource.parseModel("openai/gpt-5#fast")).toEqual(model)
    expect(Policy.Resource.model(Model.Ref.make({ provider: Provider.OpenAI, id: "gpt-5", variant: "default" }))).toBe(
      "openai/gpt-5",
    )
    expect(Policy.Resource.parseModel("openai/gpt-5#default")).toEqual({ provider: Provider.OpenAI, id: "gpt-5" })
    expect(Policy.Resource.parseModel("missing-provider")).toBeUndefined()
  })

  it("builds canonical provider, tool, composed, and sorted-pair resources", () => {
    expect(Policy.Resource.providerRequest(model)).toBe("gpt-5#fast")
    expect(Policy.Resource.provider(Provider.OpenAI)).toBe("openai")
    expect(Policy.Resource.tool("shell")).toBe("shell")
    expect(Policy.Resource.modelTool(model, "shell")).toBe("openai/gpt-5#fast::shell")
    expect(Policy.Resource.toolPair("write", "read")).toBe("read::write")
  })
})
