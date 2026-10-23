import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { CallbackQuery, UnsafeOrigin } from "../src/groups/auth.js"
import { Api } from "../src/api.js"

describe("authentication and Workspace protocol", () => {
  const headersOf = (response: object | undefined): unknown =>
    response === undefined ? undefined : Reflect.get(response, "headers")

  test("declares only the approved browser authentication routes", () => {
    const paths = OpenApi.fromApi(Api).paths

    expect(paths).toHaveProperty("/auth/login")
    expect(paths).toHaveProperty("/auth/callback")
    expect(paths).toHaveProperty("/auth/integration/callback")
    expect(paths).toHaveProperty("/auth/integration/callback/complete")
    expect(paths).toHaveProperty("/auth/logout")
    expect(Object.keys(paths["/auth/login"]?.get?.responses ?? {})).toEqual(["302", "400", "503"])
    expect(Object.keys(paths["/auth/callback"]?.get?.responses ?? {})).toEqual(["303", "400"])
    expect(Object.keys(paths["/auth/integration/callback"]?.get?.responses ?? {})).toEqual(["303", "400"])
    expect(Object.keys(paths["/auth/integration/callback/complete"]?.get?.responses ?? {})).toEqual(["200", "400"])
    expect(paths["/auth/integration/callback/complete"]?.get?.responses["200"]?.content).toHaveProperty(
      "text/html; charset=utf-8",
    )
    expect(headersOf(paths["/auth/integration/callback"]?.get?.responses["303"])).toEqual({
      "cache-control": { schema: { type: "string", const: "no-store" } },
      "content-security-policy": {
        schema: {
          type: "string",
          const: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        },
      },
      "referrer-policy": { schema: { type: "string", const: "no-referrer" } },
      location: { schema: { type: "string" } },
    })
    // Logout additionally reports 503: server-side Login Session revocation must not silently fail.
    expect(Object.keys(paths["/auth/logout"]?.post?.responses ?? {})).toEqual(["204", "400", "403", "503"])
    expect(headersOf(paths["/auth/login"]?.get?.responses["302"])).toEqual({
      "cache-control": { schema: { type: "string", const: "no-store" } },
      location: { schema: { type: "string" } },
      "set-cookie": { schema: { type: "string" } },
    })
    expect(headersOf(paths["/auth/logout"]?.post?.responses["403"])).toEqual({
      "cache-control": { schema: { type: "string", const: "no-store" } },
    })
    expect(Object.keys(paths).some((path) => path.toLowerCase().includes("probe"))).toBe(false)
  })

  test("declares callback query and unsafe Origin inputs", () => {
    const paths = OpenApi.fromApi(Api).paths

    expect(paths["/auth/callback"]?.get?.parameters?.map(({ name, required }) => ({ name, required }))).toEqual([
      { name: "code", required: false },
      { name: "state", required: false },
    ])
    expect(
      paths["/auth/logout"]?.post?.parameters?.map(({ in: location, name, required }) => ({
        location,
        name,
        required,
      })),
    ).toEqual([{ location: "header", name: "origin", required: false }])
    expect(Schema.decodeUnknownSync(UnsafeOrigin)({})).toEqual({})
    expect(Schema.decodeUnknownSync(UnsafeOrigin)({ origin: "https://app.example" })).toEqual({
      origin: "https://app.example",
    })
    expect(Schema.decodeUnknownSync(CallbackQuery)({ state: "opaque" })).toEqual({ code: "", state: "opaque" })
    expect(
      paths["/auth/integration/callback"]?.get?.parameters?.map(({ name, required }) => ({ name, required })),
    ).toEqual([
      { name: "state", required: false },
      { name: "code", required: false },
      { name: "error", required: false },
      { name: "error_description", required: false },
    ])
  })

  test("uses browser authentication without exposing bearer routes", () => {
    const browser = OpenApi.fromApi(Api)

    expect(browser.paths["/api/models"]?.get?.security).toEqual([{ cookie: [] }])
    expect(Object.keys(browser.paths).some((path) => path.startsWith("/ai/"))).toBe(false)
    expect(JSON.stringify(browser.paths)).not.toContain('"bearer"')
  })

  test("keeps endpoint identifiers stable and adds account Workspace discovery", () => {
    const identifiers: Array<string> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint }) {
        identifiers.push(endpoint.identifier)
      },
    })

    expect(identifiers).toContain("workspace.list")
    expect(identifiers).toContain("model.list")
    expect(identifiers).toContain("session.create")
    expect(identifiers).not.toContain("workspace.open")
    expect(identifiers).not.toContain("workspace.enter")
  })
})
