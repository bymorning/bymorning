import { describe, expect, it } from "@effect/vitest"
import { Account } from "@bymorning/schema/account"
import { Agent } from "@bymorning/schema/agent"
import * as InstructionSchema from "@bymorning/schema/instruction"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import * as SkillSchema from "@bymorning/schema/skill"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { createRequire } from "node:module"
import { Actor } from "../src/actor.js"
import { Instruction } from "../src/instruction.js"
import { Skill } from "../src/skill.js"
import { SkillInstruction } from "../src/skill-instruction.js"
import { InstructionEntry } from "../src/instruction-entry.js"
import { InstructionDiscovery } from "../src/instruction-discovery.js"
import { Mcp } from "../src/mcp.js"
import { Reference } from "../src/reference.js"
import * as SessionContext from "../src/session/context.js"
import { skillService } from "./service-fixtures.js"

const require = createRequire(import.meta.url)
const alphaID = SkillSchema.ID.make("skl_0000000000000000000000000a")
const betaID = SkillSchema.ID.make("skl_0000000000000000000000000b")
const alpha = SkillSchema.Info.make({
  id: alphaID,
  name: "Alpha",
  description: "Alpha summary",
  instructions: "ALPHA_FULL_BODY",
})
const beta = SkillSchema.Info.make({
  id: betaID,
  name: "Beta",
  description: "Beta summary",
  instructions: "BETA_FULL_BODY",
})
const model = Model.Ref.make({ provider: Provider.Name.make("instruction"), id: "model" })
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const agent = (permissions: Agent.Info["permissions"] = []): Agent.Info =>
  Agent.Info.make({
    id: Agent.DefaultID,
    name: Agent.Name.make("Default"),
    instructions: "base",
    model,
    mode: "primary",
    hidden: false,
    steps: null,
    permissions,
  })
const skills = (items: ReadonlyArray<SkillSchema.Info>) =>
  Layer.succeed(
    Skill.Service,
    skillService({
      list: Effect.succeed(items),
      get: () => Effect.die("unused"),
      create: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
      delete: () => Effect.die("unused"),
    }),
  )
const load = (info: Agent.Info, items: ReadonlyArray<SkillSchema.Info>) =>
  SkillInstruction.Service.use((instruction) => instruction.load(info.permissions)).pipe(
    Effect.provide(SkillInstruction.layer.pipe(Layer.provide(skills(items)))),
  )

describe("Instruction", () => {
  it("exposes only the supported package entrypoint", () => {
    expect(require.resolve("@bymorning/core/instruction")).toContain("/src/instruction.ts")
    expect(require.resolve("@bymorning/core/instruction-entry")).toContain("/src/instruction-entry.ts")
    expect(require.resolve("@bymorning/core/skill-instruction")).toContain("/src/skill-instruction.ts")
    expect(() => require.resolve("@bymorning/core/instruction/skill")).toThrow()
    expect(() => require.resolve("@bymorning/core/session/context")).toThrow()
  })

  it.effect("reads concurrently and computes canonical hash deltas", () =>
    Effect.gen(function* () {
      const sources = Instruction.make({
        key: Instruction.Key.make("test/canonical"),
        codec: Schema.Json,
        read: Effect.succeed({ b: 2, a: 1 }),
        render: { initial: JSON.stringify, changed: (_, value) => JSON.stringify(value) },
      })
      const observed = yield* Instruction.read(sources)
      const admission = yield* Instruction.diff(observed)
      expect(admission.delta).toEqual({
        "test/canonical": Instruction.hash({ a: 1, b: 2 }),
      })
      expect(Instruction.hash({ b: 2, a: 1 })).toBe(Instruction.hash({ a: 1, b: 2 }))
      expect(Instruction.applyHashDelta({}, admission.delta)).toEqual(admission.delta)
    }),
  )

  it.effect("blocks initial unavailability and ignores it after initialization", () =>
    Effect.gen(function* () {
      const source = Instruction.make({
        key: Instruction.Key.make("test/unavailable"),
        codec: Schema.String,
        read: Effect.succeed(Instruction.unavailable),
        render: { initial: String, changed: (_, value) => value },
      })
      const observed = yield* Instruction.read(source)
      expect(yield* Instruction.diff(observed).pipe(Effect.flip)).toMatchObject({
        _tag: "Instruction.InitializationError",
      })
      expect(yield* Instruction.diff(observed, {})).toEqual({ delta: {}, blobs: {} })
    }),
  )

  it("rejects empty renderer output", () => {
    const [source] = Instruction.make({
      key: Instruction.Key.make("test/empty"),
      codec: Schema.String,
      read: Effect.succeed("value"),
      render: { initial: () => "", changed: () => "" },
    })
    expect(() => source.initial("value")).toThrow("rendered an empty initial")
  })

  /** Stub every non-builtin source so the composition point can be exercised directly. */
  const sources = (load: () => Instruction.List) =>
        Layer.mergeAll(
          Layer.succeed(
            InstructionDiscovery.Service,
            InstructionDiscovery.Service.of({
              project: true,
              transform: () => Effect.succeed({ dispose: Effect.void }),
              reload: () => Effect.void,
              list: () => Effect.succeed([]),
              load: () => Effect.succeed(load()),
            }),
          ),
          Layer.succeed(
            SkillInstruction.Service,
            SkillInstruction.Service.of({ load: () => Effect.succeed(load()) }),
          ),
          Layer.succeed(
            InstructionEntry.Service,
            InstructionEntry.Service.of({
              list: () => Effect.die("unused"),
              put: () => Effect.die("unused"),
              remove: () => Effect.die("unused"),
              load: () => Effect.succeed(load()),
            }),
          ),
          Layer.succeed(
            Reference.Service,
            Reference.Service.of({
              transform: () => Effect.succeed({ dispose: Effect.void }),
              reload: () => Effect.void,
              list: () => Effect.succeed([]),
            }),
          ),
          Layer.succeed(
            Mcp.Service,
            Mcp.Service.of({
              tools: () => Effect.succeed([]),
              callTool: () => Effect.die("unused"),
              servers: () => Effect.succeed([]),
              instructions: () => Effect.succeed([]),
              authorize: () => Effect.die("unused"),
              connect: () => Effect.void,
              disconnect: () => Effect.void,
              test: () => Effect.void,
              transform: () => Effect.succeed({ dispose: Effect.void }),
              reload: () => Effect.void,
            }),
          ),
        )

  it.effect("combines both production source families and detects composition collisions", () => {
    const duplicate = () =>
      Instruction.make({
        key: Instruction.Key.make("test/collision"),
        codec: Schema.String,
        read: Effect.succeed("value"),
        render: { initial: String, changed: (_, value) => value },
      })
    return Effect.gen(function* () {
      const context = yield* SessionContext.make
      expect(
        Exit.match(
          yield* context
            .load(sessionID, agent().permissions, undefined, Workspace.ID.make("wrk_instruction"), undefined)
            .pipe(Effect.exit),
          {
            onFailure: Cause.squash,
            onSuccess: () => undefined,
          },
        ),
      ).toEqual(new Instruction.KeyError({ key: Instruction.Key.make("test/collision") }))
    }).pipe(Effect.provide(sources(duplicate)))
  })

  it.effect("assembles the system prompt with the bound member's Role and the real Integrations path", () => {
    const workspaceID = Workspace.ID.make("wrk_instruction_surface")
    const assemble = Effect.gen(function* () {
      const context = yield* SessionContext.make
      const list = yield* context.load(sessionID, agent().permissions, undefined, workspaceID, undefined)
      const admission = yield* Instruction.diff(yield* Instruction.read(list))
      const values = Object.fromEntries(
        Object.entries(admission.delta).flatMap(([key, hash]) =>
          typeof hash === "string" ? [[key, admission.blobs[hash]!]] : [],
        ),
      )
      return Instruction.renderInitial(list, values)
    })
    return Effect.gen(function* () {
      const member = yield* assemble.pipe(
        Effect.provide(
          Layer.succeed(Actor.Binding.Service, {
            workspaceID,
            accountID: Account.ID.make("acc_00000000000000000000000001"),
            userID: User.ID.make("usr_00000000000000000000000001"),
            role: "member",
          }),
        ),
      )
      expect(member).toContain(`Workspace ID: ${workspaceID}`)
      expect(member).toContain("The member you are assisting has the member Role in this Workspace")
      expect(member).toContain(`Integrations: a Console page at /w/${workspaceID}/mcp`)
      expect(member).toContain('There is no "Settings" section anywhere in ByMorning.')
      expect(member.indexOf("<env>")).toBeLessThan(member.indexOf("<app>"))

      // A caller-less construction has no member, so the surface omits the Role line but keeps the paths.
      const system = yield* assemble
      expect(system).not.toContain("Role in this Workspace")
      expect(system).toContain(`Integrations: a Console page at /w/${workspaceID}/mcp`)
    }).pipe(Effect.provide(sources(() => Instruction.empty)))
  })

  it.effect("erases typed values through the codec without confusing structural sentinel lookalikes", () =>
    Effect.gen(function* () {
      const source = Instruction.make({
        key: InstructionSchema.Key.make("test/value"),
        codec: Schema.Struct({ _tag: Schema.String, nested: Schema.Struct({ b: Schema.Finite, a: Schema.Finite }) }),
        read: Effect.succeed({ _tag: "Removed", nested: { b: 2, a: 1 } }),
        render: { initial: JSON.stringify, changed: (_, current) => JSON.stringify(current) },
      })[0]
      expect(source).toBeDefined()
      const value = yield* source.read
      expect(value).toEqual({ _tag: "Removed", nested: { b: 2, a: 1 } })
      expect(value).not.toBe(Instruction.removed)
      expect(Instruction.unavailable).not.toBe(Instruction.removed)
    }),
  )

  it("combines in order and defects on duplicate keys", () => {
    const one = Instruction.make({
      key: InstructionSchema.Key.make("test/one"),
      codec: Schema.String,
      read: Effect.succeed("one"),
      render: { initial: String, changed: (_, value) => value },
    })
    const two = Instruction.make({
      key: InstructionSchema.Key.make("test/two"),
      codec: Schema.String,
      read: Effect.succeed("two"),
      render: { initial: String, changed: (_, value) => value },
    })
    expect(Instruction.combine([one, two]).map(({ key }) => key)).toEqual(["test/one", "test/two"])
    expect(() => Instruction.combine([one, one])).toThrow("Duplicate instruction key")
  })

  it("skips undecodable retained values and treats an undecodable previous value as initial", () => {
    const [source] = Instruction.make({
      key: InstructionSchema.Key.make("test/codec"),
      codec: Schema.String,
      read: Effect.succeed("valid"),
      render: { initial: String, changed: (_, value) => value, removed: String },
    })
    expect(source.initial(1)).toBeUndefined()
    expect(source.changed(1, "valid")).toBe("valid")
    expect(source.changed("valid", 1)).toBeUndefined()
    expect(source.removed(1)).toBeUndefined()
  })

  it.effect("loads deterministic permission-filtered metadata without Skill bodies", () =>
    Effect.gen(function* () {
      const [source] = yield* load(
        agent([
          { action: "skill", resource: "*", effect: "deny" },
          { action: "skill", resource: alphaID, effect: "allow" },
          { action: "skill", resource: betaID, effect: "ask" },
        ]),
        [beta, alpha],
      )
      const value = yield* source.read
      expect(value).toEqual([
        { id: alphaID, name: "Alpha", description: "Alpha summary" },
        { id: betaID, name: "Beta", description: "Beta summary" },
      ])
      const text = source.initial(value)
      expect(text).toContain("Use the skill tool")
      expect(text).toContain("@<skill-id>")
      expect(text).not.toContain("ALPHA_FULL_BODY")
      expect(text).not.toContain("BETA_FULL_BODY")
    }),
  )

  it.effect("reports an empty visible catalog as confirmed removal", () =>
    Effect.gen(function* () {
      const [source] = yield* load(agent([{ action: "skill", resource: "*", effect: "deny" }]), [alpha])
      expect(yield* source.read).toBe(Instruction.removed)
    }),
  )

  it.effect("applies Workspace rules appended to the captured Agent rules", () =>
    Effect.gen(function* () {
      const [source] = yield* load(
        agent([
          { action: "skill", resource: alphaID, effect: "allow" },
          { action: "skill", resource: alphaID, effect: "deny" },
        ]),
        [alpha],
      )
      expect(yield* source.read).toBe(Instruction.removed)
    }),
  )

  it.effect("renders deterministic compact Skill deltas and authoritative metadata refreshes", () =>
    Effect.gen(function* () {
      const [source] = yield* load(agent([{ action: "skill", resource: "*", effect: "allow" }]), [alpha])
      const [addedSource] = yield* load(agent([{ action: "skill", resource: "*", effect: "allow" }]), [beta, alpha])
      const previous = yield* source.read
      const added = yield* addedSource.read
      expect(source.changed(previous, added)).toContain("New skills are available")

      const renamed = SkillSchema.Info.make({ ...alpha, description: "Current authoritative summary" })
      const [renamedSource] = yield* load(agent([{ action: "skill", resource: "*", effect: "allow" }]), [renamed])
      const current = yield* renamedSource.read
      const text = source.changed(previous, current)
      expect(text).toContain("Current authoritative summary")
      expect(text).not.toContain(renamed.instructions)
      expect(addedSource.changed(added, current)).toContain("supersedes the previous available skills list")
    }),
  )
})
