import { ConfigSchema } from "@bymorning/schema/config"
import type { Model } from "@bymorning/schema/model"
import type { Routing as RoutingSchema } from "@bymorning/schema/routing"
import { Workspace } from "@bymorning/schema/workspace"
import { Message, SystemPart } from "@opencode-ai/ai/schema/messages"
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Catalog } from "../src/catalog.js"
import { Config } from "../src/config.js"
import { KV } from "../src/kv.js"
import { Routing } from "../src/routing.js"

const ref = (provider: string, id: string) => ({ provider, id }) as Model.Ref
const haiku = ref("anthropic", "haiku")
const sonnet = ref("anthropic", "sonnet")
const opus = ref("anthropic", "opus")
const gpt = ref("openai", "gpt")
const general = ref("auto", "general")
const workspaceID = "00000000-0000-4000-8000-0000000000aa" as Workspace.ID

const info = (model: Model.Ref, overrides: { context?: number; input?: string[] } = {}) =>
  ({
    ...model,
    apiID: model.id,
    name: model.id,
    description: "",
    status: "active",
    releaseDate: "",
    lastUpdated: "",
    capabilities: { input: overrides.input ?? ["text", "image"], output: ["text"] },
    variants: [],
    limit: overrides.context === undefined ? {} : { context: overrides.context },
    cost: { cache: {} },
  }) as unknown as Model.Info

const tiers = (overrides: Partial<RoutingSchema.Tiers> = {}): RoutingSchema.Tiers => ({
  tiers: [
    { name: "fast", model: haiku, description: "Short factual questions" },
    { name: "mid", model: sonnet, description: "Everyday engineering" },
    { name: "deep", model: opus, description: "Multi-step architecture" },
  ],
  default: "mid",
  judge: { model: haiku, timeout: 200 },
  ...overrides,
})

const harness = (
  routing: ReadonlyArray<unknown>,
  catalog: ReadonlyArray<Model.Info> = [info(haiku), info(sonnet), info(opus, { context: 1_000 }), info(gpt)],
  kv: Partial<KV.Interface> = {},
) => {
  const store = new Map<string, unknown>()
  const decoded = Schema.decodeUnknownSync(ConfigSchema.Info)({ routing })
  const find = (model: Model.Ref) => catalog.find((entry) => entry.provider === model.provider && entry.id === model.id)
  const layer = Routing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Config.Service, { get: Effect.succeed(decoded) } as unknown as Config.Interface),
        Layer.succeed(Catalog.Service, {
          model: {
            get: (provider: string, id: string) => Effect.succeed(find(ref(provider, id))),
            requireAvailable: (model: Model.Ref) => {
              const found = find(model)
              return found === undefined ? Effect.fail(new Catalog.ModelUnavailableError({ model })) : Effect.succeed(found)
            },
          },
        } as unknown as Catalog.Interface),
        Layer.succeed(KV.Service, {
          get: (key: string) => Effect.sync(() => store.get(key) as never),
          set: (key: string, value: unknown) => Effect.sync(() => void store.set(key, value)),
          remove: (key: string) => Effect.sync(() => void store.delete(key)),
          scan: ({ prefix }: { prefix: string }) =>
            Effect.sync(() => ({
              entries: [...store].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
            })),
          ...kv,
        } as unknown as KV.Interface),
      ),
    ),
  )
  const run = <A, E>(effect: Effect.Effect<A, E, Routing.Service>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, never>)
  return { run, store }
}

const ask = (text: string, extra: ReadonlyArray<Message> = []) => Routing.digest([...extra, Message.user(text)])

const judging = (text: string) => {
  const requests: Routing.JudgeRequest[] = []
  const judge = (request: Routing.JudgeRequest) =>
    Effect.sync(() => {
      requests.push(request)
      return { text, cost: 0.001 }
    })
  return { requests, judge }
}

describe("Routing.digest", () => {
  it("reads the latest participant ask and strips reminder blocks", () => {
    const digest = Routing.digest([
      Message.user("first question"),
      Message.assistant("answer"),
      Message.user("<system-reminder>ignore me</system-reminder>\nrefactor the auth module"),
    ])
    expect(digest.ask).toBe("refactor the auth module")
    expect(digest.history).toEqual(["first question"])
    expect(digest.human).toBe(true)
  })

  it("keeps the turn stable across Tool steps and marks them non-human", () => {
    const first = [Message.user("fix the build")]
    const opening = Routing.digest(first, [SystemPart.make("system")])
    const continued = Routing.digest(
      [
        ...first,
        Message.assistant([{ type: "tool-call", id: "call_1", name: "bash", input: {} }]),
        Message.tool({ id: "call_1", name: "bash", result: { type: "text", value: "ok" } }),
        Message.user("<system-reminder>todo list</system-reminder>"),
      ],
      [SystemPart.make("system")],
    )
    expect(continued.human).toBe(false)
    expect(continued.ask).toBe("fix the build")
    expect(continued.turn).toBe(opening.turn)
    expect(Routing.digest([...first, Message.assistant("done"), Message.user("next ask")]).turn).not.toBe(opening.turn)
  })

  it("detects images and estimates tokens, including a nominal estimate per image", () => {
    const digest = Routing.digest([
      Message.user([
        { type: "text", text: "x".repeat(400) },
        { type: "media", mediaType: "image/png", data: "AAAA" },
      ]),
    ])
    expect(digest.images).toBe(true)
    expect(digest.tokens).toBe(100 + 1_000)
  })

  it("counts system text toward the token estimate", () => {
    const digest = Routing.digest([Message.user("hi")], [SystemPart.make("s".repeat(396))])
    expect(digest.tokens).toBe(100)
  })

  it("never treats compaction checkpoints or lowered synthetic context as participant asks", () => {
    const messages = [
      Message.user("real ask"),
      Message.assistant("answer"),
      Message.user("<conversation-checkpoint>\nsummary of earlier work\n\nrecent turns\n</conversation-checkpoint>"),
      Message.make({ role: "user", content: "Background work completed", metadata: { synthetic: true } }),
    ]
    const digest = Routing.digest(messages)
    expect(digest.ask).toBe("real ask")
    expect(digest.history).toEqual([])
    // The newest non-assistant message is machine-written, so the turn is not participant-opened.
    expect(digest.human).toBe(false)
    // Checkpoint and synthetic text still counts toward the context estimate.
    expect(digest.tokens).toBeGreaterThan(20)

    const resumed = Routing.digest([...messages, Message.user("next ask")])
    expect(resumed.ask).toBe("next ask")
    expect(resumed.history).toEqual(["real ask"])
    expect(resumed.human).toBe(true)
  })
})

describe("Routing.resolve", () => {
  it("leaves unmatched Catalog Models unchanged and refuses unmatched Auto names", async () => {
    const { run } = harness([])
    const decision = await run(Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant" })))
    expect(decision).toEqual({ requestedModel: gpt, model: gpt, route: { cause: "none" } })
    const error = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant" }).pipe(Effect.flip)),
    )
    expect(error._tag).toBe("Routing.UnresolvedError")
  })

  it("decodes legacy remaps and lets the last matching rule decide", async () => {
    const { run } = harness([
      { from: gpt, to: sonnet },
      { match: { model: gpt, purpose: ["title"] }, to: haiku },
    ])
    const assistant = await run(Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant" })))
    expect(assistant.model).toEqual(sonnet)
    expect(assistant.route).toEqual({ cause: "rule", rule: 0 })
    const title = await run(Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "title" })))
    expect(title.model).toEqual(haiku)
  })

  it("matches completed Tools only for Session assistant requests", async () => {
    const { run } = harness([{ when: { tool: "bash" }, to: opus }])
    const tools = new Set(["bash"])
    const assistant = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant", tools })),
    )
    expect(assistant.model).toEqual(opus)
    const title = await run(Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "title", tools })))
    expect(title.model).toEqual(gpt)
    const gateway = await run(Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant" })))
    expect(gateway.model).toEqual(gpt)
  })

  it("matches text, context, and image conditions against the digest", async () => {
    const { run } = harness([
      { match: { text: { pattern: "urgent", flags: "i" } }, to: opus },
      { match: { images: true }, to: sonnet },
    ])
    const urgent = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant", digest: ask("URGENT fix") })),
    )
    expect(urgent.model).toEqual(opus)
    const plain = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: gpt, purpose: "assistant", digest: ask("hello") })),
    )
    expect(plain.model).toEqual(gpt)
  })

  it("tests text conditions against only a bounded prefix of the ask", async () => {
    const { run } = harness([{ match: { text: { pattern: "needle" } }, to: opus }])
    const beyond = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: gpt, purpose: "assistant", digest: ask(`${"x".repeat(25_000)}needle`) }),
      ),
    )
    expect(beyond.model).toEqual(gpt)
    const within = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: gpt, purpose: "assistant", digest: ask(`needle ${"x".repeat(25_000)}`) }),
      ),
    )
    expect(within.model).toEqual(opus)
  })

  it("lets the judge choose a Tier from participant turns only", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const { requests, judge } = judging('{"tier": "deep"}')
    const digest = ask("design a sharded queue", [Message.user("earlier ask"), Message.assistant("SECRET assistant text")])
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant", digest, judge })),
    )
    expect(decision.model).toEqual(opus)
    expect(decision.route).toEqual({ cause: "judge", rule: 0, tier: "deep" })
    expect(decision.judge).toEqual({ model: haiku, cost: 0.001 })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.prompt).toContain("design a sharded queue")
    expect(requests[0]!.prompt).toContain("earlier ask")
    expect(requests[0]!.prompt).not.toContain("SECRET")
  })

  it.each([
    ["invalid", "I think deep", undefined],
    ["error", undefined, "error"],
    ["timeout", undefined, "timeout"],
  ] as const)("falls back to the default Tier when the judge is %s", async (reason, text, mode) => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const judge = () =>
      mode === "error"
        ? Effect.fail("boom")
        : mode === "timeout"
          ? Effect.never
          : Effect.succeed({ text: text ?? "" })
    const decision = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: ask("hi"), judge }),
      ),
    )
    expect(decision.model).toEqual(sonnet)
    expect(decision.route).toEqual({ cause: "fallback", fallback: reason, rule: 0, tier: "mid" })
  })

  it("uses the default Tier without judging when no judge is supplied", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "title", digest: ask("hi") })),
    )
    expect(decision.route).toEqual({ cause: "rule", rule: 0, tier: "mid" })
  })

  it("never judges a non-assistant purpose, even when a judge is supplied", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const { requests, judge } = judging('{"tier":"deep"}')
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "title", digest: ask("hi"), judge })),
    )
    expect(decision.model).toEqual(sonnet)
    expect(decision.route).toEqual({ cause: "rule", rule: 0, tier: "mid" })
    expect(decision.judge).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it("uses the only runnable Tier without judging", async () => {
    const { run } = harness(
      [{ match: { model: general }, to: tiers() }],
      [info(haiku, { input: ["text"] }), info(sonnet), info(opus, { context: 1_000 })],
    )
    const { requests, judge } = judging('{"tier":"deep"}')
    const digest = Routing.digest([
      Message.user([
        { type: "text", text: "what is this" },
        { type: "media", mediaType: "image/png", data: "AAAA" },
      ]),
    ])
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant", digest, judge })),
    )
    // Only mid remains: fast takes no images and deep's context is too small for the estimated tokens.
    expect(decision.model).toEqual(sonnet)
    expect(decision.route).toEqual({ cause: "rule", rule: 0, tier: "mid" })
    expect(decision.judge).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it("never offers Tiers without image input when the request carries images", async () => {
    const { run } = harness(
      [{ match: { model: general }, to: tiers({ default: "deep" }) }],
      [info(haiku, { input: ["text"] }), info(sonnet), info(opus)],
    )
    const { requests, judge } = judging('{"tier":"mid"}')
    const digest = Routing.digest([
      Message.user([
        { type: "text", text: "y".repeat(8_000) },
        { type: "media", mediaType: "image/png", data: "AAAA" },
      ]),
    ])
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant", digest, judge })),
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]!.prompt).not.toContain("- fast:")
    expect(requests[0]!.prompt).toContain("- mid:")
    expect(requests[0]!.prompt).toContain("- deep:")
    expect(decision.model).toEqual(sonnet)
  })

  it("never offers Tiers too small for the estimated context, system text included", async () => {
    const { run } = harness(
      [{ match: { model: general }, to: tiers() }],
      [info(haiku), info(sonnet), info(opus, { context: 1_000 })],
    )
    const { requests, judge } = judging('{"tier":"mid"}')
    // 700 tokens of ask plus 400 tokens of system text overflow the 950-token headroom of deep.
    const digest = Routing.digest([Message.user("y".repeat(2_800))], [SystemPart.make("s".repeat(1_600))])
    const decision = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant", digest, judge })),
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]!.prompt).toContain("- fast:")
    expect(requests[0]!.prompt).toContain("- mid:")
    expect(requests[0]!.prompt).not.toContain("- deep:")
    expect(decision.model).toEqual(sonnet)
  })

  it("skips Tiers the entrypoint does not admit and fails when none can run", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const error = await run(
      Routing.Service.use((routing) =>
        routing
          .resolve({ requestedModel: general, purpose: "assistant", admits: () => Effect.succeed(false) })
          .pipe(Effect.flip),
      ),
    )
    expect(error._tag).toBe("Routing.UnavailableError")
  })

  it("pins a judged Tier for the Tool steps of the same ask", async () => {
    const { run, store } = harness([{ match: { model: general }, to: tiers() }])
    const { requests, judge } = judging('{"tier":"deep"}')
    const pin = { workspaceID }
    const history = [Message.user("migrate the database")]
    const opening = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: Routing.digest(history), judge, pin }),
      ),
    )
    expect(opening.route.cause).toBe("judge")
    expect(store.size).toBe(1)
    const step = Routing.digest([
      ...history,
      Message.assistant([{ type: "tool-call", id: "c1", name: "bash", input: {} }]),
      Message.tool({ id: "c1", name: "bash", result: { type: "text", value: "ok" } }),
    ])
    const continued = await run(
      Routing.Service.use((routing) => routing.resolve({ requestedModel: general, purpose: "assistant", digest: step, judge, pin })),
    )
    expect(continued.model).toEqual(opus)
    expect(continued.route).toEqual({ cause: "pinned", rule: 0, tier: "deep" })
    expect(requests).toHaveLength(1)
  })

  it("uses the default Tier for an unpinned Tool step without judging", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }])
    const { requests, judge } = judging('{"tier":"deep"}')
    const step = Routing.digest([
      Message.user("migrate"),
      Message.assistant([{ type: "tool-call", id: "c1", name: "bash", input: {} }]),
      Message.tool({ id: "c1", name: "bash", result: { type: "text", value: "ok" } }),
    ])
    const decision = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: step, judge, pin: { workspaceID } }),
      ),
    )
    expect(decision.route).toEqual({ cause: "fallback", fallback: "unpinned", rule: 0, tier: "mid" })
    expect(requests).toHaveLength(0)
  })

  it.each([
    ["dies", () => Effect.die(new Error("KV down"))],
    ["fails", () => Effect.fail("KV down") as Effect.Effect<never>],
  ] as const)("judges a Tool step again when the pin store %s on read", async (_mode, get) => {
    const { run } = harness([{ match: { model: general }, to: tiers() }], undefined, { get })
    const { requests, judge } = judging('{"tier":"deep"}')
    const step = Routing.digest([
      Message.user("migrate"),
      Message.assistant([{ type: "tool-call", id: "c1", name: "bash", input: {} }]),
      Message.tool({ id: "c1", name: "bash", result: { type: "text", value: "ok" } }),
    ])
    const decision = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: step, judge, pin: { workspaceID } }),
      ),
    )
    expect(decision.model).toEqual(opus)
    expect(decision.route).toEqual({ cause: "judge", rule: 0, tier: "deep" })
    expect(requests).toHaveLength(1)
  })

  it("returns the judged decision when the pin store cannot be written", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }], undefined, {
      set: () => Effect.die(new Error("KV down")),
    })
    const { requests, judge } = judging('{"tier":"deep"}')
    const decision = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: ask("migrate"), judge, pin: { workspaceID } }),
      ),
    )
    expect(decision.model).toEqual(opus)
    expect(decision.route).toEqual({ cause: "judge", rule: 0, tier: "deep" })
    expect(requests).toHaveLength(1)
  })

  it("returns the judged decision when pin cleanup cannot scan", async () => {
    const { run } = harness([{ match: { model: general }, to: tiers() }], undefined, {
      scan: () => Effect.die(new Error("KV down")),
    })
    const { requests, judge } = judging('{"tier":"deep"}')
    const decision = await run(
      Routing.Service.use((routing) =>
        routing.resolve({ requestedModel: general, purpose: "assistant", digest: ask("migrate"), judge, pin: { workspaceID } }),
      ),
    )
    expect(decision.model).toEqual(opus)
    expect(decision.route).toEqual({ cause: "judge", rule: 0, tier: "deep" })
    expect(requests).toHaveLength(1)
  })
})

describe("Routing.check and names", () => {
  it("reports every invalid rule", async () => {
    const { run } = harness([])
    const rules = Schema.decodeUnknownSync(Schema.Array(ConfigSchema.Routing))([
      { match: { model: gpt }, to: ref("openai", "missing") },
      { match: {}, to: general },
      { match: { text: { pattern: "(" } }, to: gpt },
      { match: { context: { min: 10, max: 1 } }, to: gpt },
      {
        match: { model: general },
        to: tiers({
          tiers: [
            { name: "a", model: haiku, description: "x" },
            { name: "a", model: general, description: "y" },
          ],
          default: "z",
          judge: { model: general },
        }),
      },
    ])
    const error = await run(Routing.Service.use((routing) => routing.check(rules).pipe(Effect.flip)))
    expect(error.issues.map((issue) => issue.rule)).toEqual([0, 1, 1, 2, 3, 4, 4, 4, 4])
  })

  it("lists distinct Auto names", async () => {
    const { run } = harness([
      { match: { model: general }, to: tiers() },
      { match: { model: { ...general, variant: "x" }, purpose: ["title"] }, to: haiku },
      { match: { model: gpt }, to: sonnet },
    ])
    expect(await run(Routing.Service.use((routing) => routing.names))).toEqual([general])
  })
})
