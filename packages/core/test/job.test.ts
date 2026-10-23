import { SessionID } from "@bymorning/schema/identifier"
import { Deferred, Effect, Exit, Fiber, Layer, Ref, Scope } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, test } from "vitest"
import { Job } from "../src/job.js"

const parent = SessionID.make("00000000-0000-4000-8000-000000000701")
const other = SessionID.make("00000000-0000-4000-8000-000000000702")

function it<A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope>) {
  test(name, () => Effect.runPromise(Effect.scoped(body())))
}

describe("Job", () => {
  it("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        title: "Tracked work",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(typeof job.id).toBe("string")
      expect(job).toMatchObject({
        type: "test",
        title: "Tracked work",
        status: "running",
        metadata: { durable: false },
      })
      if (job.metadata) job.metadata.durable = true
      expect(yield* jobs.get(job.id)).toMatchObject({ status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: "missing" })).toEqual({ timedOut: false })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      const completed = yield* jobs.wait({ id: job.id })
      expect(typeof completed.info?.completed_at).toBe("number")
      expect(completed).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
      expect(yield* jobs.background(job.id)).toBeUndefined()
    }).pipe(Effect.provide(Job.layer)))

  it("returns a running snapshot when a positive wait timeout expires", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({ id: "job_timeout", type: "test", run: Effect.never })
      const waiting = yield* jobs.wait({ id: job.id, timeout: 1_000 }).pipe(Effect.forkChild)

      yield* TestClock.adjust("1 second")

      expect(yield* Fiber.join(waiting)).toMatchObject({ timedOut: true, info: { id: job.id, status: "running" } })
    }).pipe(Effect.provide(Layer.merge(Job.layer, TestClock.layer()))))

  it("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service

      yield* Effect.forEach(Array.from({ length: 50 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running" ? Effect.succeed(`done-${index}`) : Effect.fail("started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }).pipe(Effect.provide(Job.layer)))

  it("joins duplicate running starts and creates a new generation after settlement", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const executions = yield* Ref.make<string[]>([])
      const first = yield* jobs.start({
        id: "job_generation",
        type: "first",
        run: Ref.update(executions, (values) => [...values, "first"]).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Deferred.await(release)),
          Effect.as("first output"),
        ),
      })
      yield* Deferred.await(started)

      const duplicate = yield* jobs.start({
        id: first.id,
        type: "duplicate",
        run: Ref.update(executions, (values) => [...values, "duplicate"]).pipe(Effect.as("duplicate output")),
      })

      expect(duplicate).toMatchObject({ id: first.id, type: "first", status: "running" })
      expect(yield* Ref.get(executions)).toEqual(["first"])
      yield* Deferred.succeed(release, undefined)
      expect(yield* jobs.wait({ id: first.id })).toMatchObject({ info: { output: "first output" } })

      const second = yield* jobs.start({
        id: first.id,
        type: "second",
        run: Ref.update(executions, (values) => [...values, "second"]).pipe(Effect.as("second output")),
      })
      expect(yield* jobs.wait({ id: first.id })).toMatchObject({
        info: { type: "second", status: "completed", output: "second output" },
      })
      expect(second.started_at).toBeGreaterThan(first.started_at)
      expect(yield* Ref.get(executions)).toEqual(["first", "second"])
    }).pipe(Effect.provide(Job.layer)))

  it("records failures and preserves the first terminal settlement", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const failed = yield* jobs.start({ id: "job_error", type: "test", run: Effect.fail("broken") })
      const result = yield* jobs.wait({ id: failed.id })
      expect(typeof result.info?.completed_at).toBe("number")
      expect(result).toMatchObject({ info: { status: "error", error: "broken" } })

      const interrupted = yield* Deferred.make<void>()
      const releaseFinalizer = yield* Deferred.make<void>()
      const cancelled = yield* jobs.start({
        id: "job_cancelled",
        type: "test",
        run: Effect.never.pipe(
          Effect.ensuring(
            Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Deferred.await(releaseFinalizer))),
          ),
        ),
      })
      yield* Effect.addFinalizer(() => Deferred.succeed(releaseFinalizer, undefined))
      const waiting = yield* jobs.wait({ id: cancelled.id }).pipe(Effect.forkChild)
      const blocking = yield* jobs.block({ id: cancelled.id, sessionID: parent }).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const cancelling = yield* jobs.cancel(cancelled.id).pipe(Effect.forkChild)
      yield* Deferred.await(interrupted)

      expect(yield* jobs.get(cancelled.id)).toMatchObject({ status: "cancelled" })
      expect(yield* Fiber.join(waiting)).toMatchObject({ info: { status: "cancelled" } })
      expect(yield* Fiber.join(blocking)).toMatchObject({ type: "finished", info: { status: "cancelled" } })
      expect(cancelling.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseFinalizer, undefined)
      expect(yield* Fiber.join(cancelling)).toMatchObject({ status: "cancelled" })
      expect(yield* jobs.wait({ id: cancelled.id })).toMatchObject({ info: { status: "cancelled" } })
      expect(yield* jobs.cancel("missing")).toBeUndefined()
    }).pipe(Effect.provide(Job.layer)))

  it("protects a replacement generation while cancelled cleanup is still running", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const cleanupStarted = yield* Deferred.make<void>()
      const releaseCleanup = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(releaseCleanup, undefined))
      const first = yield* jobs.start({
        id: "job_cancel_replacement",
        type: "first",
        run: Effect.never.pipe(
          Effect.ensuring(
            Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseCleanup))),
          ),
        ),
      })
      const cancelling = yield* jobs.cancel(first.id).pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      expect(yield* jobs.wait({ id: first.id })).toMatchObject({ info: { status: "cancelled" } })

      yield* jobs.start({ id: first.id, type: "replacement", run: Effect.succeed("replacement output") })
      expect(yield* jobs.wait({ id: first.id })).toMatchObject({
        info: { type: "replacement", status: "completed", output: "replacement output" },
      })
      yield* Deferred.succeed(releaseCleanup, undefined)
      yield* Fiber.join(cancelling)
      expect(yield* jobs.get(first.id)).toMatchObject({
        type: "replacement",
        status: "completed",
        output: "replacement output",
      })
    }).pipe(Effect.provide(Job.layer)))

  it("publishes one state when completion and cancellation race", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      yield* Effect.forEach(Array.from({ length: 25 }), (_, index) =>
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            id: `job_cancel_race_${index}`,
            type: "test",
            run: Deferred.await(release).pipe(Effect.as("done")),
          })
          const waiting = yield* jobs.wait({ id: job.id }).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.all([Deferred.succeed(release, undefined), jobs.cancel(job.id)], {
            concurrency: "unbounded",
            discard: true,
          })
          const observed = (yield* Fiber.join(waiting)).info
          const current = yield* jobs.get(job.id)
          expect(current?.status).toBe(observed?.status)
          if (current?.status === "completed") expect(current.output).toBe("done")
          if (current?.status === "cancelled") expect(current.output).toBeUndefined()
        }),
      )
    }).pipe(Effect.timeout("5 seconds"), Effect.provide(Job.layer)))

  it("returns finished or backgrounded according to the first blocking signal", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const firstRelease = yield* Deferred.make<void>()
      const first = yield* jobs.start({
        id: "job_block_finished",
        type: "test",
        run: Deferred.await(firstRelease).pipe(Effect.as("done")),
      })
      const finished = yield* jobs
        .block({ id: first.id, sessionID: parent })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Deferred.succeed(firstRelease, undefined)
      expect(yield* Fiber.join(finished)).toMatchObject({
        type: "finished",
        info: { status: "completed", output: "done" },
      })

      const secondRelease = yield* Deferred.make<void>()
      const second = yield* jobs.start({
        id: "job_block_backgrounded",
        type: "test",
        run: Deferred.await(secondRelease).pipe(Effect.as("done")),
      })
      const backgrounded = yield* jobs
        .block({ id: second.id, sessionID: parent })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      expect(yield* jobs.background(second.id)).toMatchObject({ status: "running" })
      expect(yield* Fiber.join(backgrounded)).toMatchObject({
        type: "backgrounded",
        info: { id: second.id, status: "running" },
      })
      expect(yield* jobs.block({ id: second.id, sessionID: parent })).toMatchObject({ type: "backgrounded" })
      yield* Deferred.succeed(secondRelease, undefined)
      expect(yield* jobs.wait({ id: second.id })).toMatchObject({ info: { status: "completed", output: "done" } })

      expect(yield* jobs.block({ id: "missing", sessionID: parent })).toBeUndefined()
      expect(yield* jobs.block({ id: first.id, sessionID: parent })).toMatchObject({ type: "finished" })
    }).pipe(Effect.provide(Job.layer)))

  it("backgrounds only matching jobs actively blocking a session", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const release = yield* Deferred.make<void>()
      const first = yield* jobs.start({
        id: "job_filtered_first",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as("first")),
      })
      const second = yield* jobs.start({
        id: "job_filtered_second",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as("second")),
      })
      const third = yield* jobs.start({
        id: "job_filtered_third",
        type: "other",
        run: Deferred.await(release).pipe(Effect.as("third")),
      })
      const scope = yield* Scope.Scope
      const firstWait = yield* jobs
        .block({ id: first.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const secondWait = yield* jobs
        .block({ id: second.id, sessionID: other })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const thirdWait = yield* jobs
        .block({ id: third.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))

      expect(yield* jobs.backgroundAll({ sessionID: parent, type: "test" })).toMatchObject([{ id: first.id }])
      expect(yield* Fiber.join(firstWait)).toMatchObject({ type: "backgrounded", info: { id: first.id } })

      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(secondWait)).toMatchObject({ type: "finished", info: { id: second.id } })
      expect(yield* Fiber.join(thirdWait)).toMatchObject({ type: "finished", info: { id: third.id } })
    }).pipe(Effect.provide(Job.layer)))

  it("reference-counts blockers for the same session", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({ id: "job_reference_count", type: "test", run: Effect.never })
      const first = yield* jobs.block({ id: job.id, sessionID: parent }).pipe(Effect.forkChild)
      const second = yield* jobs.block({ id: job.id, sessionID: parent }).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      yield* Fiber.interrupt(first)

      expect(yield* jobs.backgroundAll({ sessionID: parent })).toMatchObject([{ id: job.id }])
      expect(yield* Fiber.join(second)).toMatchObject({ type: "backgrounded", info: { id: job.id } })
      expect(yield* jobs.backgroundAll({ sessionID: parent })).toEqual([])
    }).pipe(Effect.provide(Job.layer)))

  it("does not hang when completion and backgrounding race", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service

      yield* Effect.forEach(Array.from({ length: 25 }), (_, index) =>
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            id: `job_background_race_${index}`,
            type: "test",
            run: Deferred.await(release).pipe(Effect.as("done")),
          })
          const blocked = yield* jobs.block({ id: job.id, sessionID: parent }).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.all([jobs.background(job.id), Deferred.succeed(release, undefined)], {
            concurrency: "unbounded",
            discard: true,
          })

          expect(["finished", "backgrounded"]).toContain((yield* Fiber.join(blocked))?.type)
          expect(yield* jobs.wait({ id: job.id })).toMatchObject({ info: { status: "completed", output: "done" } })
        }),
      )
    }).pipe(Effect.provide(Job.layer)))

  it("interrupts and settles live work when the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        type: "test",
        run: Effect.addFinalizer(() => Deferred.succeed(interrupted, undefined)).pipe(Effect.andThen(Effect.never)),
      })

      yield* Scope.close(scope, Exit.void)
      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))

      expect(yield* jobs.get(job.id)).toMatchObject({ status: "cancelled" })
    }))

  it("owns nested scoped work independently of the caller scope", () =>
    Effect.gen(function* () {
      const registryScope = yield* Scope.make()
      const callerScope = yield* Scope.make()
      const childStarted = yield* Deferred.make<void>()
      const childInterrupted = yield* Deferred.make<void>()
      const jobs = yield* Job.make.pipe(Scope.provide(registryScope))
      const job = yield* jobs
        .start({
          id: "job_nested_scope",
          type: "test",
          run: Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Deferred.succeed(childInterrupted, undefined))
            yield* Deferred.succeed(childStarted, undefined)
            return yield* Effect.never
          }),
        })
        .pipe(Scope.provide(callerScope))
      yield* Deferred.await(childStarted)

      yield* Scope.close(callerScope, Exit.void)
      expect(yield* Deferred.isDone(childInterrupted)).toBe(false)
      expect(yield* jobs.get(job.id)).toMatchObject({ status: "running" })

      expect(yield* jobs.cancel(job.id)).toMatchObject({ status: "cancelled" })
      expect(yield* Deferred.isDone(childInterrupted)).toBe(true)
      yield* Scope.close(registryScope, Exit.void)
    }))

  it("isolates independently constructed registries", () =>
    Effect.gen(function* () {
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const first = yield* Job.make.pipe(Scope.provide(firstScope))
      const second = yield* Job.make.pipe(Scope.provide(secondScope))
      const id = "job_shared_id"

      yield* first.start({ id, type: "first", run: Effect.succeed("first output") })
      yield* second.start({ id, type: "second", run: Effect.never })

      expect(yield* first.wait({ id })).toMatchObject({ info: { type: "first", output: "first output" } })
      expect(yield* second.wait({ id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { type: "second", status: "running" },
      })

      yield* Scope.close(firstScope, Exit.void)
      yield* Scope.close(secondScope, Exit.void)
    }))
})
