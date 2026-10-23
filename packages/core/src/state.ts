export * as State from "./state.js"

import { Cause, Context, Effect, Exit, Fiber, Layer, Scope, Semaphore } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "./actor.js"

/** A replayable transform applied to a editor when state is read. */
type TransformCallback<EditorApi> = (editor: EditorApi) => void
export type MakeEditor<State, EditorApi> = (state: State) => EditorApi

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

/** Registers a scoped transform. Reads rebuild by applying every transform in order. */
export type Transform<EditorApi> = (
  transform: TransformCallback<EditorApi>,
) => Effect.Effect<Registration, never, Scope.Scope>

/** Invalidates the current value after captured inputs change and notifies like a registration would. */
export type Reload = () => Effect.Effect<void>

export interface Transformable<EditorApi> {
  readonly transform: Transform<EditorApi>
  readonly reload: Reload
}

/** Serializes plugin generation commits with persisted base installation. */
export interface Coordinator {
  readonly batch: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export const makeCoordinator = (): Coordinator => {
  const semaphore = Semaphore.makeUnsafe(1)
  return {
    batch: (effect) => semaphore.withPermit(batch(effect)),
    exclusive: (effect) => semaphore.withPermit(effect),
  }
}

export class Service extends Context.Service<Service, Coordinator>()("@bymorning/core/State") {}

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.effect(Service, Effect.map(Actor.Binding.Service, () => Service.of(makeCoordinator()))),
  deps: [Actor.binding],
})

type Batch = {
  active: boolean
  readonly shutdown: boolean
  readonly notifications: Set<Effect.Effect<void>>
}

const CurrentBatch = Context.Reference<Batch | undefined>("@opencode/State/CurrentBatch", {
  defaultValue: () => undefined,
})

/** Coalesces notifications until the effect completes. Reads inside stay fresh; nothing is rolled back. */
export function batch<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
export function batch<A, E, R>(coordinator: Coordinator, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
export function batch<A, E, R>(
  coordinatorOrEffect: Coordinator | Effect.Effect<A, E, R>,
  input?: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  if (input !== undefined) return (coordinatorOrEffect as Coordinator).batch(input)
  return run(coordinatorOrEffect as Effect.Effect<A, E, R>, false)
}

/** Runs the effect as shutdown: States changed inside it close permanently and never notify again. */
export function shutdown<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return run(effect, true)
}

function run<A, E, R>(effect: Effect.Effect<A, E, R>, shutdown: boolean): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = yield* CurrentBatch
      if (current?.active && !shutdown) return yield* restore(effect)
      const currentBatch = { active: true, shutdown, notifications: new Set() } as Batch
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatch, currentBatch))).pipe(Effect.exit)
      currentBatch.active = false
      const notifications = yield* Effect.forEach(currentBatch.notifications, (notify) => restore(notify).pipe(Effect.exit))
      yield* Exit.asVoidAll([exit, ...notifications])
      return yield* exit
    }),
  )
}

export function reconcile(
  root: Scope.Scope,
  fork: (effect: Effect.Effect<void>) => Fiber.Fiber<void>,
  work: () => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const exit = yield* Fiber.await(fork(work()))
    if (Exit.isFailure(exit) && root.state._tag === "Closed" && Cause.hasInterruptsOnly(exit.cause)) return
    yield* exit
  })
}

export const inherit = Effect.fnUntraced(function* () {
  const currentBatch = yield* CurrentBatch
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentBatch, currentBatch)
})

export interface Options<State, EditorApi> {
  readonly name?: string
  /** Creates the empty base value for every rebuild. */
  readonly initial: () => State
  /** Wraps mutable state in a domain-specific editor API. */
  readonly editor: MakeEditor<State, EditorApi>
  readonly coordinator?: Coordinator
  /** bm extension: seals a complete rebuilt value before it becomes observable. */
  readonly seal?: (state: State) => State
  /** Observes the rebuilt value outside the read path. */
  readonly notify?: (state: State) => Effect.Effect<void>
}

export interface Interface<State, EditorApi> extends Transformable<EditorApi> {
  readonly get: () => State
  /** bm extension: installs a persisted base under the shared coordinator, then invalidates. */
  readonly rebase: <Base, E, R>(load: Effect.Effect<Base, E, R>, install: (base: Base) => boolean) => Effect.Effect<void, E, R>
}

export function create<State, EditorApi>(options: Options<State, EditorApi>): Interface<State, EditorApi> {
  let state = options.initial()
  const transforms: { run: TransformCallback<EditorApi> }[] = []
  let dirty = false
  let closed = false

  const get = () => {
    if (closed || !dirty) return state
    const next = options.initial()
    const editor = options.editor(next)
    for (const transform of transforms) transform.run(editor)
    // A failed fold leaves the previous value observable and remains dirty.
    state = options.seal?.(next) ?? next
    dirty = false
    return state
  }

  const notify = Effect.gen(function* () {
    if (closed) return
    const value = get()
    if (options.notify) yield* options.notify(value)
  }).pipe(Effect.withSpan("State.notify")) as Effect.Effect<void>

  const changed = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (closed) return
      dirty = true
      const currentBatch = yield* CurrentBatch
      if (currentBatch?.active) {
        if (currentBatch.shutdown) {
          closed = true
          return
        }
        currentBatch.notifications.add(notify)
        return
      }
      yield* restore(notify)
    }),
  )

  return {
    get,
    rebase: (load, install) => {
      const effect = Effect.gen(function* () {
        const base = yield* load
        if (install(base)) yield* changed
      })
      return options.coordinator?.exclusive(effect) ?? effect
    },
    transform: Effect.fn("State.transform")(function* (update) {
      yield* Effect.annotateCurrentSpan("state", options.name ?? "anonymous")
      const scope = yield* Scope.Scope
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const transform = { run: update }
          const dispose = Effect.uninterruptible(
            Effect.suspend(() => {
              const index = transforms.indexOf(transform)
              if (index < 0) return Effect.void
              transforms.splice(index, 1)
              return changed
            }),
          )
          transforms.push(transform)
          yield* Scope.addFinalizer(scope, dispose)
          yield* changed
          return { dispose }
        }),
      )
    }),
    reload: () => changed,
  }
}
