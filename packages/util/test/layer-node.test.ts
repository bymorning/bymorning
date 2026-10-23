import { describe, expect, test } from "vitest"
import { Context, Effect, Layer, LayerMap, Scope } from "effect"
import { tags } from "../src/effect/app-node.js"
import { LayerNode } from "../src/effect/layer-node.js"

class Value extends Context.Service<Value, { readonly value: string }>()("test/Value") {}
class Greeting extends Context.Service<Greeting, { readonly value: string }>()("test/Greeting") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/Left") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/Right") {}

const value = LayerNode.make({
  service: Value,
  layer: Layer.succeed(Value, Value.of({ value: "production" })),
  deps: [],
})
const greeting = LayerNode.make({
  service: Greeting,
  layer: Layer.effect(
    Greeting,
    Effect.map(Value, (item) => Greeting.of({ value: `hello ${item.value}` })),
  ),
  deps: [value],
})

describe("LayerNode", () => {
  test("compiles selected roots without exposing dependencies", async () => {
    const layer = LayerNode.compile(LayerNode.group([greeting]))
    const check: Layer.Layer<Greeting> = layer
    void check
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello production",
    )
  })

  test("replaces by declaration identity and skips replaced wiring", async () => {
    let acquired = 0
    const original = LayerNode.make({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => {
          acquired++
          return Value.of({ value: "old" })
        }),
      ),
      deps: [],
    })
    const root = LayerNode.make({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.map(Value, (item) => Greeting.of({ value: item.value })),
      ),
      deps: [original],
    })
    const replacement = Layer.succeed(Value, Value.of({ value: "new" }))
    const layer = LayerNode.compile(root, { replacements: [original.replace(replacement)] })
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe("new")
    expect(acquired).toBe(0)
  })

  test("bind defers replacement until compile", async () => {
    const bound = LayerNode.bind(LayerNode.group([greeting]), [
      value.replace(Layer.succeed(Value, Value.of({ value: "bound" }))),
    ])
    const layer = LayerNode.compile(bound)
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello bound",
    )
  })

  test("bind preserves a root declaration identity for its own replacement", async () => {
    const slot = LayerNode.unbound(Value, tags.values.global)
    const bound = LayerNode.bind(slot, [slot.replace(Layer.succeed(Value, Value.of({ value: "bound" })))])
    const layer = LayerNode.compile(bound)
    expect(await Effect.runPromise(Effect.map(Value, (item) => item.value).pipe(Effect.provide(layer)))).toBe("bound")
  })

  test("bind preserves a tagged node's tag and replacement compatibility", async () => {
    const global = tags.make("global")({
      service: Value,
      layer: Layer.succeed(Value, Value.of({ value: "production" })),
      deps: [],
    })
    const bound = LayerNode.bind(global, [])
    expect(bound.tag).toBe(tags.values.global)
    const layer = LayerNode.compile(bound, {
      replacements: [bound.replace(Layer.succeed(Value, Value.of({ value: "replacement" })))],
      shared: tags.values.global,
    })
    expect(await Effect.runPromise(Effect.map(Value, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "replacement",
    )
  })

  test("compile replacements override attached bindings", async () => {
    const bound = LayerNode.bind(LayerNode.group([greeting]), [
      value.replace(Layer.succeed(Value, Value.of({ value: "bound" }))),
    ])
    const layer = LayerNode.compile(bound, {
      replacements: [value.replace(Layer.succeed(Value, Value.of({ value: "explicit" })))],
    })
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello explicit",
    )
  })

  test("bound sibling policy remains branch-local", async () => {
    const left = LayerNode.make({
      service: Left,
      layer: Layer.effect(
        Left,
        Effect.map(Value, (item) => Left.of({ value: item.value })),
      ),
      deps: [value],
    })
    const right = LayerNode.make({
      service: Right,
      layer: Layer.effect(
        Right,
        Effect.map(Value, (item) => Right.of({ value: item.value })),
      ),
      deps: [value],
    })
    const boundLeft = LayerNode.bind(left, [value.replace(Layer.succeed(Value, Value.of({ value: "left" })))])
    const layer = LayerNode.compile(LayerNode.group([boundLeft, right]))
    expect(
      await Effect.runPromise(
        Effect.gen(function* () {
          return [(yield* Left).value, (yield* Right).value]
        }).pipe(Effect.provide(layer)),
      ),
    ).toEqual(["left", "production"])
  })

  test("requires unbound declarations to be replaced", () => {
    const slot = LayerNode.unbound(Value, tags.values.global)
    const root = tags.make("workspace")({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.map(Value, (item) => Greeting.of({ value: item.value })),
      ),
      deps: [slot],
    })
    expect(() => LayerNode.compile(root)).toThrow("Unbound layer node")
  })

  test("rejects one Layer implementation wired to different dependencies", () => {
    const implementation = Layer.effect(
      Greeting,
      Effect.map(Value, (item) => Greeting.of({ value: item.value })),
    )
    const first = LayerNode.make({ service: Greeting, layer: implementation, deps: [value] })
    const other = LayerNode.make({
      service: Value,
      layer: Layer.succeed(Value, Value.of({ value: "other" })),
      deps: [],
    })
    const second = LayerNode.make({ name: "test/other-greeting", layer: implementation, deps: [other] })
    expect(() => LayerNode.compile(LayerNode.group([first, second]))).toThrow("wired to different dependencies")
  })

  test("does not acquire unreachable replacement", async () => {
    let acquired = 0
    const unused = LayerNode.make({ service: Left, layer: Layer.succeed(Left, Left.of({ value: "unused" })), deps: [] })
    const replacement = Layer.effect(
      Left,
      Effect.sync(() => {
        acquired++
        return Left.of({ value: "replacement" })
      }),
    )
    await Effect.runPromise(
      Effect.map(Greeting, (item) => item.value).pipe(
        Effect.provide(
          LayerNode.compile(greeting, {
            replacements: [unused.replace(replacement)],
          }),
        ),
      ),
    )
    expect(acquired).toBe(0)
  })

  test("replaces matching declarations rather than matching names", async () => {
    const sameName = LayerNode.make({
      name: value.name,
      layer: Layer.succeed(Value, Value.of({ value: "other" })),
      deps: [],
    })
    const layer = LayerNode.compile(greeting, {
      replacements: [sameName.replace(Layer.succeed(Value, Value.of({ value: "changed" })))],
    })
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello production",
    )
  })

  test("preserves provider decoration", async () => {
    const decorated = value.mapLayer((layer) => layer)
    const layer = LayerNode.compile(greeting, { replacements: [value.replace(decorated)] })
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello production",
    )
  })

  test("later bindings win for the same source", async () => {
    const first = LayerNode.bind(greeting, [value.replace(Layer.succeed(Value, Value.of({ value: "first" })))])
    const bound = LayerNode.bind(first, [value.replace(Layer.succeed(Value, Value.of({ value: "last" })))])
    const layer = LayerNode.compile(bound)
    expect(await Effect.runPromise(Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(layer)))).toBe(
      "hello last",
    )
  })

  test("a replacement removes its original dependency acquisition", async () => {
    let acquired = 0
    const original = LayerNode.make({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => {
          acquired++
          return Value.of({ value: "old" })
        }),
      ),
      deps: [],
    })
    const root = LayerNode.make({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.map(Value, (item) => Greeting.of({ value: item.value })),
      ),
      deps: [original],
    })
    await Effect.runPromise(
      Effect.map(Greeting, (item) => item.value).pipe(
        Effect.provide(
          LayerNode.compile(root, {
            replacements: [original.replace(Layer.succeed(Value, Value.of({ value: "replacement" })))],
          }),
        ),
      ),
    )
    expect(acquired).toBe(0)
  })

  test("keeps separate declarations with equal outputs independent", async () => {
    const first = LayerNode.make({ service: Left, layer: Layer.succeed(Left, Left.of({ value: "first" })), deps: [] })
    const second = LayerNode.make({
      service: Right,
      layer: Layer.succeed(Right, Right.of({ value: "second" })),
      deps: [],
    })
    const layer = LayerNode.compile(LayerNode.group([first, second]))
    expect(
      await Effect.runPromise(
        Effect.gen(function* () {
          return [(yield* Left).value, (yield* Right).value]
        }).pipe(Effect.provide(layer)),
      ),
    ).toEqual(["first", "second"])
  })

  test("shares tagged subgraphs while keeping remaining acquisition local", async () => {
    let globals = 0
    let members = 0
    const global = tags.make("global")({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => {
          globals++
          return Value.of({ value: "global" })
        }),
      ),
      deps: [],
    })
    const member = tags.make("workspace")({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.map(Value, (item) => {
          members++
          return Greeting.of({ value: item.value })
        }),
      ),
      deps: [global],
    })
    const layer = LayerNode.compile(member, { shared: tags.values.global })
    await Effect.runPromise(Layer.build(layer).pipe(Effect.scoped))
    await Effect.runPromise(Layer.build(layer).pipe(Effect.scoped))
    expect(globals).toBe(2) // separate application memo maps
    expect(members).toBe(2)
  })

  test("reuses globals through one enclosing memo map while rebuilding members", async () => {
    let globals = 0
    let members = 0
    const global = tags.make("global")({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => Value.of({ value: String(++globals) })),
      ),
      deps: [],
    })
    const boundGlobal = LayerNode.bind(global, [])
    const member = tags.make("workspace")({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.map(Value, (item) => Greeting.of({ value: `${item.value}:${++members}` })),
      ),
      deps: [boundGlobal],
    })
    const compiled = LayerNode.compile(member, { shared: tags.values.global })
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const memo = Layer.makeMemoMapUnsafe()
        yield* Layer.buildWithMemoMap(compiled, memo, scope)
        yield* Layer.buildWithMemoMap(compiled, memo, scope)
      }).pipe(Effect.scoped),
    )
    expect(globals).toBe(1)
    expect(members).toBe(2)
  })

  test("lets a lazy LayerMap inherit the enclosing global memo map", async () => {
    let globals = 0
    const global = tags.make("global")({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.sync(() => Value.of({ value: String(++globals) })),
      ),
      deps: [],
    })
    const member = tags.make("workspace")({
      service: Greeting,
      layer: Layer.effect(
        Greeting,
        Effect.gen(function* () {
          const map = yield* LayerMap.make(() => LayerNode.compile(global, { shared: tags.values.global }))
          yield* Layer.build(map.get("first"))
          yield* Layer.build(map.get("second"))
          return Greeting.of({ value: "member" })
        }),
      ),
      deps: [global],
    })
    await Effect.runPromise(Layer.build(LayerNode.compile(member, { shared: tags.values.global })).pipe(Effect.scoped))
    expect(globals).toBe(1)
  })
})
