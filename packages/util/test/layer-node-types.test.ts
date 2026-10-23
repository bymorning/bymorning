import { test } from "vitest"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "../src/effect/layer-node.js"
import { makeGlobalNode, makeWorkspaceNode, tags } from "../src/effect/app-node.js"
class A extends Context.Service<A, {}>()("test/A") {}
class B extends Context.Service<B, {}>()("test/B") {}
class C extends Context.Service<C, {}>()("test/C") {}
class BootError {
  readonly _tag = "BootError"
}
class AdapterError {
  readonly _tag = "AdapterError"
}
const a = makeGlobalNode({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })
const b = makeWorkspaceNode({ service: B, layer: Layer.effect(B, Effect.as(A, B.of({}))), deps: [a] })
const graph = LayerNode.group([b])
const layer: Layer.Layer<B> = LayerNode.compile(graph)
void layer
// @ts-expect-error Layer graphs remain nominal declarations rather than plain objects.
const forgedGraph: LayerNode.Graph<never> = { name: "forged" }
void forgedGraph

const cLayer = Layer.effect(
  C,
  Effect.gen(function* () {
    yield* A
    yield* B
    return C.of({})
  }),
)
const c = makeWorkspaceNode({ service: C, layer: cLayer, deps: [a, b] })
const multiService: Layer.Layer<C> = LayerNode.compile(LayerNode.group([c]))
void multiService
const slot = LayerNode.unbound<A, {}, typeof import("../src/effect/app-node.js").tags.values.global, BootError>(
  A,
  (await import("../src/effect/app-node.js")).tags.values.global,
)
slot.replace(Layer.effect(A, Effect.fail(new BootError())))
// @ts-expect-error A replacement must provide A
slot.replace(Layer.succeed(B, B.of({})))
const strictSlot = LayerNode.unbound(A, tags.values.global)
const hostSlot = LayerNode.unbound<A, {}, typeof tags.values.global, unknown>(A, tags.values.global)
hostSlot.replace(Layer.effect(A, Effect.fail(new BootError())))
hostSlot.replace(Layer.effect(A, Effect.fail(new AdapterError())))
const workspaceSlot = LayerNode.unbound(A, tags.values.workspace)
// @ts-expect-error Node declarations are invariant in their allowed error slot.
const widenedError: LayerNode.Node<A, BootError, typeof tags.values.global> = strictSlot
void widenedError
const openLayer = Layer.effect(
  A,
  Effect.map(B, () => A.of({})),
)
if (process.env["TYPECHECK_ONLY"] === "true") {
  // @ts-expect-error A declaration needs exactly one identity: a service or a name.
  LayerNode.make({ layer: Layer.succeed(A, A.of({})), deps: [] })
  // @ts-expect-error A declaration cannot use both identity forms.
  LayerNode.make({ service: A, name: "test/A", layer: Layer.succeed(A, A.of({})), deps: [] })
  // @ts-expect-error B requires A.
  makeWorkspaceNode({ service: B, layer: Layer.effect(B, Effect.as(A, B.of({}))), deps: [] })
  // @ts-expect-error C requires both A and B.
  makeWorkspaceNode({ service: C, layer: cLayer, deps: [a] })
  // @ts-expect-error an ordinary declaration cannot gain a boot error
  strictSlot.replace(Layer.effect(A, Effect.fail(new BootError())))
  // @ts-expect-error a replacement cannot cross ownership tags
  strictSlot.replace(workspaceSlot)
  // @ts-expect-error raw Layer replacements must be closed
  strictSlot.replace(openLayer)

  // @ts-expect-error A tag may only name declared ownership scopes.
  LayerNode.tags({ workspace: ["missing"], global: [] })

  const scopes = LayerNode.tags({ workspace: ["global"], global: [] })
  const global = scopes.make("global")
  const workspace = scopes.make("workspace")
  class ScopedA extends Context.Service<ScopedA, {}>()("test/ScopedA") {}
  class ScopedB extends Context.Service<ScopedB, {}>()("test/ScopedB") {}
  class ScopedC extends Context.Service<ScopedC, {}>()("test/ScopedC") {}
  const scopedA = Layer.succeed(ScopedA, ScopedA.of({}))
  const scopedB = Layer.effect(ScopedB, Effect.as(ScopedA, ScopedB.of({})))
  const scopedC = Layer.effect(
    ScopedC,
    Effect.gen(function* () {
      yield* ScopedA
      yield* ScopedB
      return ScopedC.of({})
    }),
  )
  const globalA = global({ service: ScopedA, layer: scopedA, deps: [] })
  const workspaceA = workspace({ service: ScopedA, layer: scopedA, deps: [] })
  const workspaceB = workspace({ service: ScopedB, layer: scopedB, deps: [globalA] })
  workspace({ service: ScopedC, layer: scopedC, deps: [LayerNode.group([globalA, workspaceB])] })
  // @ts-expect-error A global declaration cannot depend on a workspace declaration.
  global({ service: ScopedB, layer: scopedB, deps: [workspaceA] })
  // @ts-expect-error A group preserves its workspace ownership tag.
  global({ service: ScopedB, layer: scopedB, deps: [LayerNode.group([workspaceA])] })
  // @ts-expect-error Multi-service requirements cannot be satisfied by duplicate A providers.
  workspace({ service: ScopedC, layer: scopedC, deps: [globalA, workspaceA] })
}
test("type exploration compiles", () => {})
