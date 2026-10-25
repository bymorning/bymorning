import { OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as Session from "@bymorning/schema/session"
import * as Auth from "@bymorning/schema/auth"
import * as User from "@bymorning/schema/user"
import type * as Usage from "@bymorning/schema/usage"
import type * as Workspace from "@bymorning/schema/workspace"
import { ID as WorkspaceID } from "@bymorning/schema/workspace"
import { describe, expect, expectTypeOf, test } from "vitest"
import {
  ByMorning as PromiseByMorning,
  type UserListInput,
  type UserListOutput,
  type UserInviteInput,
  type UserInviteOutput,
  type UsageOverviewInput,
  type UsageOverviewOutput,
  type UsageListInput,
  type UsageListOutput,
  type UsageRecordsInput,
  type UsageRecordsOutput,
} from "../../client/src/promise/index.js"
import { ByMorning as EffectByMorning } from "../../client/src/effect/index.js"
import type { UserInviteOperation, UserListOperation, UsageOverviewOperation } from "../../client/src/effect/api.js"
import { Api } from "../src/api.js"

describe("generated client Protocol contract", () => {
  test("exposes Workspace members through the ergonomic User client", async () => {
    const workspace = WorkspaceID.make("wrk_members")
    const member = {
      id: User.ID.make("usr_member"),
      email: Auth.Email.make("member@bymorning.ai"),
      role: "member" as const,
      status: "pending" as const,
    }
    const requests = new Array<{ url: string; method: string; body?: string }>()
    const fetch: NonNullable<Parameters<typeof PromiseByMorning.make>[0]["fetch"]> = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() })
      return Response.json(init?.method === "POST" ? member : { role: "admin", members: [member] })
    }
    const client = PromiseByMorning.make({ baseUrl: "https://example.test", fetch })

    expectTypeOf<UserListInput>().toEqualTypeOf<{ readonly workspace?: Workspace.ID }>()
    expectTypeOf<UserListOutput["members"][number]["role"]>().toEqualTypeOf<User.Role>()
    expectTypeOf<UserInviteInput>().toEqualTypeOf<{
      readonly workspace?: Workspace.ID
      readonly email: Auth.Email
      readonly role: User.InvitationRole
    }>()
    expectTypeOf<UserInviteOutput["status"]>().toEqualTypeOf<User.Status>()
    expectTypeOf<Parameters<UserListOperation>[0]>().toEqualTypeOf<UserListInput | undefined>()
    expectTypeOf<Parameters<UserInviteOperation>[0]>().toEqualTypeOf<UserInviteInput>()
    expect(await client.user.list({ workspace })).toEqual({ role: "admin", members: [member] })
    expect(await client.user.invite({ workspace, email: member.email, role: "member" })).toEqual(member)
    expect(requests).toEqual([
      { url: "https://example.test/api/users?workspace=wrk_members", method: "GET", body: undefined },
      {
        url: "https://example.test/api/users?workspace=wrk_members",
        method: "POST",
        body: JSON.stringify({ email: "member@bymorning.ai", role: "member" }),
      },
    ])
    expect(OpenApi.fromApi(Api).paths["/api/users"]?.get?.operationId).toBe("api.user.user.list")
    expect(OpenApi.fromApi(Api).paths["/api/users"]?.post?.operationId).toBe("api.user.user.invite")
  })

  test("exposes the required usage window and decodes the numeric overview", async () => {
    const workspace = WorkspaceID.make("wrk_usage")
    const requests = new Array<string>()
    const aggregate = {
      invocations: 1,
      cost: 1.5,
      costComplete: false,
      tokens: { total: 15, input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    }
    const fetch: NonNullable<Parameters<typeof PromiseByMorning.make>[0]["fetch"]> = async (input) => {
      requests.push(String(input))
      return Response.json({
        days: 30,
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-30T12:00:00.000Z",
        total: aggregate,
        daily: [{ date: "2026-08-01", usage: aggregate }],
        users: [{ userID: User.ID.make("usr_usage"), usage: aggregate }],
        models: [{ model: "bymorning/route-model", usage: aggregate }],
      })
    }
    const client = PromiseByMorning.make({ baseUrl: "https://example.test", fetch })

    expectTypeOf<UsageOverviewInput>().toEqualTypeOf<{
      readonly workspace?: Workspace.ID
      readonly days: 7 | 30 | 90
    }>()
    expectTypeOf<UsageOverviewOutput["days"]>().toEqualTypeOf<Usage.Days>()
    expectTypeOf<UsageOverviewOutput["total"]["costComplete"]>().toEqualTypeOf<boolean>()
    expectTypeOf<UsageOverviewOutput["total"]["tokens"]>().toEqualTypeOf<{
      total: number
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }>()
    expectTypeOf<Parameters<UsageOverviewOperation>[0]>().toEqualTypeOf<UsageOverviewInput>()

    const overview = await client.usage.overview({ workspace, days: 30 })
    expect(overview).toMatchObject({
      days: 30,
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-30T12:00:00.000Z"),
      total: aggregate,
      daily: [{ date: "2026-08-01", usage: aggregate }],
      users: [{ userID: "usr_usage", usage: aggregate }],
      models: [{ model: "bymorning/route-model", usage: aggregate }],
    })
    expect(requests).toEqual(["https://example.test/api/usage/overview?workspace=wrk_usage&days=30"])
  })

  test("exposes paginated persisted usage records", async () => {
    const workspace = WorkspaceID.make("wrk_usage")
    const fetch: NonNullable<Parameters<typeof PromiseByMorning.make>[0]["fetch"]> = async () =>
      Response.json({
        data: [
          {
            id: "00000000-0000-4000-8000-000000000741",
            model: "effective-model",
            createdAt: "2026-08-30T12:00:00.000Z",
            usage: {
              cost: 1.5,
              costComplete: false,
              tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
            },
          },
        ],
        cursor: "next_page",
      })
    const client = PromiseByMorning.make({ baseUrl: "https://example.test", fetch })

    expectTypeOf<UsageListInput>().toEqualTypeOf<{
      readonly workspace?: Workspace.ID
      readonly cursor?: string
      readonly limit?: number
    }>()
    expectTypeOf<UsageListOutput["data"][number]["id"]>().toEqualTypeOf<Usage.Info["id"]>()
    expectTypeOf<UsageListOutput["data"][number]["sessionID"]>().toEqualTypeOf<Usage.Info["sessionID"]>()
    expectTypeOf<UsageListOutput["data"][number]["model"]>().toMatchTypeOf<Usage.Info["model"]>()
    expectTypeOf<Usage.Info["model"]>().toMatchTypeOf<UsageListOutput["data"][number]["model"]>()
    expectTypeOf<UsageRecordsInput>().toEqualTypeOf<{
      readonly workspace?: Workspace.ID
      readonly cursor?: string
      readonly limit?: number
    }>()
    expectTypeOf<UsageRecordsOutput["data"][number]["id"]>().toEqualTypeOf<Usage.ID>()
    expectTypeOf<UsageRecordsOutput["data"][number]["model"]>().toEqualTypeOf<string>()
    expect(await client.usage.records({ workspace, cursor: "current_page", limit: 50 })).toMatchObject({
      data: [{ model: "effective-model", createdAt: new Date("2026-08-30T12:00:00.000Z") }],
      cursor: "next_page",
    })
  })

  test("Promise client sends the active query and decodes active and interrupt responses", async () => {
    const requests = new Array<{ readonly url: string; readonly method: string }>()
    const fetch: NonNullable<Parameters<typeof PromiseByMorning.make>[0]["fetch"]> = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" })
      if (init?.method === "POST") return new Response(null, { status: 204 })
      return Response.json({ "00000000-0000-4000-8000-000000000000": { type: "running" } })
    }
    const client = PromiseByMorning.make({ baseUrl: "https://example.test", fetch })

    expect(await client.session.active({ workspace: WorkspaceID.make("wrk_contract") })).toEqual({
      "00000000-0000-4000-8000-000000000000": { type: "running" },
    })
    expect(await client.session.interrupt({ sessionID: Session.ID.make("00000000-0000-4000-8000-000000000000") })).toBe(
      undefined,
    )
    expect(requests).toEqual([
      { url: "https://example.test/api/session/active?workspace=wrk_contract", method: "GET" },
      {
        url: "https://example.test/api/session/00000000-0000-4000-8000-000000000000/interrupt",
        method: "POST",
      },
    ])
  })

  test("Effect client sends the active query and decodes active and interrupt responses", async () => {
    const requests = new Array<{ readonly url: string; readonly method: string }>()
    const http = HttpClient.make((request) => {
      requests.push({
        url: HttpClientRequest.toUrl(request).pipe(Option.getOrThrow).toString(),
        method: request.method,
      })
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          request.method === "POST"
            ? new Response(null, { status: 204 })
            : Response.json({ "00000000-0000-4000-8000-000000000000": { type: "running" } }),
        ),
      )
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* EffectByMorning.make({ baseUrl: "https://example.test" })
        expect(yield* client.session.active({ workspace: WorkspaceID.make("wrk_contract") })).toEqual({
          "00000000-0000-4000-8000-000000000000": { type: "running" },
        })
        expect(
          yield* client.session.interrupt({ sessionID: Session.ID.make("00000000-0000-4000-8000-000000000000") }),
        ).toBe(undefined)
      }).pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, http))),
    )
    expect(requests).toEqual([
      { url: "https://example.test/api/session/active?workspace=wrk_contract", method: "GET" },
      {
        url: "https://example.test/api/session/00000000-0000-4000-8000-000000000000/interrupt",
        method: "POST",
      },
    ])
  })

  test("declares ForbiddenError for every unsafe browser resource method", () => {
    const paths = OpenApi.fromApi(Api).paths
    let unsafeCount = 0

    for (const [path, item] of Object.entries(paths)) {
      if (!path.startsWith("/api/")) continue
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const operation = item[method]
        if (operation === undefined) continue
        unsafeCount += 1
        expect(operation.responses, `${method.toUpperCase()} ${path}`).toHaveProperty("403")
      }
    }

    expect(unsafeCount).toBeGreaterThan(0)
  })
})
