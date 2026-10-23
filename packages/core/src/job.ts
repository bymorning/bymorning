export * as Job from "./job.js"

import { ascending } from "@bymorning/schema/identifier"
import type { Session } from "@bymorning/schema/session"
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Scope, SynchronizedRef } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  owner: Deferred.Deferred<Fiber.Fiber<void>>
  token: object
  blockingSessions: Map<Session.ID, number>
  isBackgrounded: boolean
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  owner?: Deferred.Deferred<Fiber.Fiber<void>>
}

type BackgroundResult = {
  info?: Info
  backgrounded?: Deferred.Deferred<Info>
}

type StartResult =
  | { info: Info }
  | {
      info: Info
      scope: Scope.Closeable
      owner: Deferred.Deferred<Fiber.Fiber<void>>
      token: object
    }

type BlockWait = {
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  token: object
}

type BlockStart =
  | { type: "missing" }
  | { type: "finished"; info: Info }
  | { type: "backgrounded"; info: Info }
  | { type: "wait"; wait: BlockWait }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  run: Effect.Effect<string, unknown, Scope.Scope>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export type BlockInput = {
  id: string
  sessionID: Session.ID
}

export type BlockResult = { type: "finished"; info: Info } | { type: "backgrounded"; info: Info }

export type BackgroundAllInput = {
  sessionID: Session.ID
  type?: string
}

export interface Interface {
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly block: (input: BlockInput) => Effect.Effect<BlockResult | undefined>
  readonly background: (id: string) => Effect.Effect<Info | undefined>
  readonly backgroundAll: (input: BackgroundAllInput) => Effect.Effect<Info[]>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Job") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const message = error.message.trim()
  if (message.length > 0) return message
  // Tagged errors with no message (e.g. CodeInterpreter.UnavailableError) are still identifiable by tag.
  const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : undefined
  return tag ?? error.name
}

function incrementSession(input: Map<Session.ID, number>, sessionID: Session.ID) {
  return new Map(input).set(sessionID, (input.get(sessionID) ?? 0) + 1)
}

function decrementSession(input: Map<Session.ID, number>, sessionID: Session.ID) {
  const count = input.get(sessionID)
  if (count === undefined) return input
  const next = new Map(input)
  if (count <= 1) next.delete(sessionID)
  else next.set(sessionID, count - 1)
  return next
}

/** Construct one scoped, process-local Job registry for a Workspace graph. */
export const make = Effect.gen(function* () {
  const state = {
    jobs: yield* SynchronizedRef.make(new Map<string, Active>()),
    scope: yield* Scope.Scope,
  }

  const settle = Effect.fnUntraced(function* (id: string, token: object, exit: Exit.Exit<string, unknown>) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.token !== token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const status = (
        Exit.isSuccess(exit) ? "completed" : Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "error"
      ) satisfies Exclude<Status, "running">
      const next = {
        ...job,
        blockingSessions: new Map<Session.ID, number>(),
        info: {
          ...job.info,
          status,
          completed_at,
          ...(Exit.isSuccess(exit) ? { output: exit.value } : {}),
          ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
        },
      } satisfies Active
      return [{ info: snapshot(next), done: job.done }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    return result.info
  })

  const fork = Effect.fnUntraced(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    owner: Deferred.Deferred<Fiber.Fiber<void>>,
    run: Effect.Effect<string, unknown, Scope.Scope>,
  ) {
    const fiber = yield* Effect.uninterruptibleMask((restore) =>
      restore(run.pipe(Scope.provide(scope))).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Scope.close(scope, exit).pipe(Effect.andThen(settle(id, token, exit)))),
        Effect.asVoid,
      ),
    ).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    yield* Deferred.succeed(owner, fiber)
    return fiber
  })

  const get = Effect.fn("Job.get")(function* (id: string) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return snapshot(job)
  })

  const start = Effect.fnUntraced(function* (input: StartInput) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? `job_${ascending()}`
        const now = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const backgrounded = yield* Deferred.make<Info>()
        const owner = yield* Deferred.make<Fiber.Fiber<void>>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartResult, Map<string, Active>]
            }
            const scope = yield* Scope.make()
            const token = {}
            const started_at = Math.max(now, (existing?.info.started_at ?? -1) + 1)
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
              },
              done,
              backgrounded,
              owner,
              token,
              blockingSessions: new Map<Session.ID, number>(),
              isBackgrounded: false,
            }
            return [{ info: snapshot(job), scope, owner, token }, new Map(jobs).set(id, job)] as readonly [
              StartResult,
              Map<string, Active>,
            ]
          }),
        )
        if ("scope" in result) yield* fork(result.scope, id, result.token, result.owner, restore(input.run))
        return result.info
      }),
    )
  })

  const wait = Effect.fn("Job.wait")(function* (input: WaitInput) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
    if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
    if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
    const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
    if (info._tag === "Some") return { info: info.value, timedOut: false }
    return { info: snapshot(job), timedOut: true }
  })

  const removeBlock = Effect.fnUntraced(function* (input: BlockInput, token: object) {
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.token !== token || job.info.status !== "running" || job.isBackgrounded) return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        blockingSessions: decrementSession(job.blockingSessions, input.sessionID),
      })
    })
  })

  const block = Effect.fnUntraced(function* (input: BlockInput) {
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
      const job = jobs.get(input.id)
      if (!job) return [{ type: "missing" }, jobs]
      if (job.info.status !== "running") return [{ type: "finished", info: snapshot(job) }, jobs]
      if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
      return [
        { type: "wait", wait: { done: job.done, backgrounded: job.backgrounded, token: job.token } },
        new Map(jobs).set(input.id, {
          ...job,
          blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
        }),
      ]
    })
    if (result.type === "missing") return undefined
    if (result.type === "finished") return { type: "finished" as const, info: result.info }
    if (result.type === "backgrounded") return { type: "backgrounded" as const, info: result.info }
    return yield* Effect.raceFirst(
      Deferred.await(result.wait.done).pipe(Effect.map((info) => ({ type: "finished" as const, info }))),
      Deferred.await(result.wait.backgrounded).pipe(Effect.map((info) => ({ type: "backgrounded" as const, info }))),
    ).pipe(Effect.ensuring(removeBlock(input, result.wait.token)))
  })

  const background = Effect.fn("Job.background")(function* (id: string) {
    const result = yield* SynchronizedRef.modify(
      state.jobs,
      (jobs): readonly [BackgroundResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job || job.info.status !== "running") return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const next = {
          ...job,
          isBackgrounded: true,
          blockingSessions: new Map<Session.ID, number>(),
        }
        return [{ info: snapshot(next), backgrounded: job.backgrounded }, new Map(jobs).set(id, next)]
      },
    )
    if (result.info && result.backgrounded)
      yield* Deferred.succeed(result.backgrounded, result.info).pipe(Effect.ignore)
    return result.info
  })

  const backgroundAll = Effect.fn("Job.backgroundAll")(function* (input: BackgroundAllInput) {
    const result = yield* SynchronizedRef.modify(
      state.jobs,
      (jobs): readonly [BackgroundResult[], Map<string, Active>] => {
        const results: BackgroundResult[] = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running") continue
          if (job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const updated = {
            ...job,
            isBackgrounded: true,
            blockingSessions: new Map<Session.ID, number>(),
          }
          results.push({ info: snapshot(updated), backgrounded: job.backgrounded })
          next.set(id, updated)
        }
        return [results, next]
      },
    )
    yield* Effect.forEach(
      result,
      (item) => (item.info && item.backgrounded ? Deferred.succeed(item.backgrounded, item.info) : Effect.void),
      { discard: true },
    )
    return result.flatMap((item) => (item.info ? [item.info] : []))
  })

  const cancel = Effect.fn("Job.cancel")(function* (id: string) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const next = {
        ...job,
        blockingSessions: new Map<Session.ID, number>(),
        info: {
          ...job.info,
          status: "cancelled" as const,
          completed_at,
        },
      }
      return [{ info: snapshot(next), done: job.done, owner: job.owner }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.owner) yield* Deferred.await(result.owner).pipe(Effect.flatMap(Fiber.interrupt))
    return result.info
  })

  return Service.of({ get, start, wait, block, background, backgroundAll, cancel })
})

/** Scoped process-local Job registry Layer for one Workspace graph. */
export const layer = Layer.effect(Service, make)

/** Canonical workspace-local background Job authority. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [] })

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = () => makeWorkspaceNode({ service: Service, layer, deps: [] })
