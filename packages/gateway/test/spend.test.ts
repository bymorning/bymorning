import { describe, expect, it } from "@effect/vitest"
import { Actor } from "@bymorning/core/actor"
import { Budget } from "@bymorning/core/budget"
import { CurrentActor, CurrentReservation, SpendMiddleware, spendMiddlewareLayer } from "@bymorning/gateway/api"
import { ServiceUnavailableError } from "@bymorning/protocol/errors"
import { Account as AccountSchema } from "@bymorning/schema/account"
import { UserActor } from "@bymorning/schema/actor"
import type { Holder } from "@bymorning/schema/budget"
import { User as UserSchema } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, Option, Ref, Stream } from "effect"
import { Headers, type HttpBody, HttpServerResponse } from "effect/unstable/http"

const workspaceID = Workspace.ID.create()
const userID = UserSchema.ID.create()
const userActor = new UserActor({
  type: "user",
  properties: { accountID: AccountSchema.ID.create(), userID, workspaceID, role: "member" },
})
const expectedHolders = Actor.holders(userActor)

const succeed = Effect.succeed(HttpServerResponse.empty())

/** Router-shaped middleware options; the caller-facing endpoint decides the refusal envelope. */
const options = (endpoint: string) => ({ endpoint: { name: endpoint }, group: { name: "llm-gateway" } }) as never

const bodyText = (body: HttpBody.HttpBody) =>
  body._tag === "Stream"
    ? Effect.map(Stream.runCollect(body.stream), (chunks) =>
        Array.from(chunks, (chunk) => new TextDecoder().decode(chunk)).join(""),
      )
    : Effect.succeed("")

const unused = () => Effect.die("unused")

/** Real SpendMiddleware layer over a fake Budget.Service that records every reserve call. */
const layerWith = (
  reserves: Ref.Ref<ReadonlyArray<ReadonlyArray<Holder>>>,
  outcome: Effect.Effect<Budget.Reservation, Budget.ExceededError | Budget.StoreError>,
) =>
  spendMiddlewareLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Budget.Service,
          Budget.Service.of({
            reserve: (holders) =>
              Ref.update(reserves, (seen) => [...seen, holders]).pipe(Effect.andThen(() => outcome)),
            limit: unused,
            status: unused,
          }),
        ),
      ),
    ),
  )

/**
 * Drives the middleware handler directly inside one request-like Scope. The
 * typed handler nominally consumes the router's HttpApi route context, which a
 * unit test does not construct.
 */
const spend = (
  httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, never, CurrentReservation>,
  endpoint: string,
) =>
  Effect.gen(function* () {
    const middleware = yield* SpendMiddleware
    return yield* (
      middleware(httpEffect, options(endpoint)) as Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        ServiceUnavailableError
      >
    ).pipe(Effect.provideService(CurrentActor, userActor))
  })

describe("SpendMiddleware", () => {
  it.effect("reserves every Actor holder and exposes the reservation to the endpoint", () => {
    const reserves = Ref.makeUnsafe<ReadonlyArray<ReadonlyArray<Holder>>>([])
    const observed = Ref.makeUnsafe(false)
    const endpointBody = Effect.gen(function* () {
      yield* CurrentReservation
      yield* Ref.set(observed, true)
      return HttpServerResponse.empty()
    })
    return Effect.gen(function* () {
      yield* spend(endpointBody, "llm-gateway.anthropicMessages")
      expect(yield* Ref.get(reserves)).toEqual([expectedHolders])
      expect(yield* Ref.get(observed)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(layerWith(reserves, Effect.succeed({ settle: () => Effect.void }))))
  })

  it.effect("renders an exhausted limit as a native 429 with a rounded Retry-After", () => {
    const reserves = Ref.makeUnsafe<ReadonlyArray<ReadonlyArray<Holder>>>([])
    return Effect.gen(function* () {
      const anthropic = yield* spend(succeed, "llm-gateway.anthropicMessages")
      expect(anthropic.status).toBe(429)
      expect(Option.getOrUndefined(Headers.get(anthropic.headers, "retry-after"))).toBe("2")
      expect(JSON.parse(yield* bodyText(anthropic.body))).toMatchObject({
        type: "error",
        error: { type: "rate_limit_error" },
      })
      const openai = yield* spend(succeed, "llm-gateway.openaiChat")
      expect(openai.status).toBe(429)
      expect(JSON.parse(yield* bodyText(openai.body))).toMatchObject({
        error: { type: "rate_limit_error", code: null },
      })
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerWith(
          reserves,
          Effect.fail(new Budget.ExceededError({ holder: Actor.holder.workspace(workspaceID), retryAfter: 1500 })),
        ),
      ),
    )
  })

  it.effect("fails the transport with ServiceUnavailableError when the store is broken", () => {
    const reserves = Ref.makeUnsafe<ReadonlyArray<ReadonlyArray<Holder>>>([])
    return spend(succeed, "llm-gateway.openaiChat").pipe(
      Effect.scoped,
      Effect.flip,
      Effect.map((failure) => expect(failure).toBeInstanceOf(ServiceUnavailableError)),
      Effect.provide(
        layerWith(reserves, Effect.fail(new Budget.StoreError({ operation: "reserve", cause: "offline" }))),
      ),
    )
  })
})
