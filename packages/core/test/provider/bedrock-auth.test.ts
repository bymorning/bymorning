import { describe, expect, it } from "@effect/vitest"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Credential } from "@bymorning/schema/credential"
import { Effect, Option, Ref } from "effect"
import { Headers, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Integration } from "../../src/integration.js"
import { Provider } from "../../src/provider.js"
import { middleware } from "../../src/provider/bedrock-auth.js"

const region = AwsRegion.make("us-east-1")
const id = Credential.ID.make("cred_bedrock")
const integrationID = Integration.ID.make("bedrock-auth-test")
const canonical = "https://bedrock-runtime.us-east-1.amazonaws.com"
const path = "/model/amazon.nova-lite-v1%3A0/converse-stream"
const response = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientResponse.fromWeb(request, new Response(null))
const body = new TextEncoder().encode('{"messages":[]}')

describe("Bedrock authentication", () => {
  it.effect("applies rotated bearer credentials lazily only to the exact canonical route", () => {
    const credential = Ref.makeUnsafe("first")
    const resolutions = Ref.makeUnsafe(0)
    return Effect.gen(function* () {
      const auth = middleware({
        integrations: integration({
          credential: Ref.update(resolutions, (count) => count + 1).pipe(
            Effect.andThen(Ref.get(credential)),
            Effect.map((key) => ({
              type: "key" as const,
              key,
              configuration: { type: "aws-region" as const, region },
            })),
          ),
        }),
        integration: integrationID,
        region,
        connection: { type: "credential", id, authKind: "bearer" },
        canonicalOrigin: canonical,
        plannedOrigin: canonical,
        apiID: "amazon.nova-lite-v1:0",
      })
      const authorization = yield* Ref.make<string | undefined>(undefined)
      const observe = (request: HttpClientRequest.HttpClientRequest) =>
        auth(request, (authenticated) =>
          Ref.set(authorization, Option.getOrUndefined(Headers.get(authenticated.headers, "authorization"))).pipe(
            Effect.as(response(authenticated)),
          ),
        )

      yield* observe(request(`${canonical}${path}`))
      expect(yield* Ref.get(authorization)).toBe("Bearer first")
      yield* Ref.set(credential, "second")
      yield* observe(request(`${canonical}${path}`))
      expect(yield* Ref.get(authorization)).toBe("Bearer second")

      const passThrough = [
        request(`https://other.example${path}`),
        request(`${canonical}/wrong`),
        request(`${canonical}${path}?x=1`),
        HttpClientRequest.put(`${canonical}${path}`).pipe(
          HttpClientRequest.bodyUint8Array(body, "application/json"),
          HttpClientRequest.setHeader("authorization", "Plugin secret"),
        ),
      ]
      for (const candidate of passThrough) {
        const authorization = yield* Ref.make<string | undefined>(undefined)
        yield* auth(candidate, (authenticated) =>
          Ref.set(authorization, Option.getOrUndefined(Headers.get(authenticated.headers, "authorization"))).pipe(
            Effect.as(response(authenticated)),
          ),
        )
        expect(yield* Ref.get(authorization)).toBe("Plugin secret")
      }
      yield* middleware({
        integrations: integration({ credential: Effect.die("must not resolve") }),
        integration: integrationID,
        region,
        connection: { type: "credential", id, authKind: "bearer" },
        canonicalOrigin: canonical,
        plannedOrigin: "https://router.example",
        apiID: "amazon.nova-lite-v1:0",
      })(request(`${canonical}${path}`), (unchanged) => Effect.succeed(response(unchanged)))
      expect(yield* Ref.get(resolutions)).toBe(2)
    })
  })

  it.effect("signs the exact bytes for Bedrock and strips stale AWS headers", () =>
    Effect.gen(function* () {
      const auth = middleware({
        integrations: integration({
          credential: Effect.succeed({
            type: "aws-sigv4",
            region,
            accessKeyId: "AKIDEXAMPLE",
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            sessionToken: "session-token",
          }),
          authKind: "sigv4",
        }),
        integration: integrationID,
        region,
        connection: { type: "credential", id, authKind: "sigv4" },
        canonicalOrigin: canonical,
        plannedOrigin: canonical,
        apiID: "amazon.nova-lite-v1:0",
      })
      const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
      yield* auth(
        request(`${canonical}${path}`).pipe(
          HttpClientRequest.setHeader("authorization", "stale"),
          HttpClientRequest.setHeader("x-amz-date", "stale"),
        ),
        (signed) => Ref.set(observed, signed).pipe(Effect.as(response(signed))),
      )
      const signed = yield* Ref.get(observed)
      expect(signed).toBeDefined()
      if (signed === undefined) return
      expect(signed.body._tag).toBe("Uint8Array")
      if (signed.body._tag === "Uint8Array") expect(signed.body.body).toBe(body)
      expect(Option.getOrUndefined(Headers.get(signed.headers, "authorization"))).toContain("Credential=AKIDEXAMPLE/")
      expect(Option.getOrUndefined(Headers.get(signed.headers, "authorization"))).toContain(
        "/us-east-1/bedrock/aws4_request",
      )
      expect(Option.getOrUndefined(Headers.get(signed.headers, "x-amz-security-token"))).toBe("session-token")
      expect(Option.getOrUndefined(Headers.get(signed.headers, "x-amz-date"))).not.toBe("stale")
    }),
  )

  it.effect("[SEC-FIPSEP-05] SigV4 signs the FIPS-designated hostname with the unchanged bedrock service scope", () =>
    Effect.gen(function* () {
      const fips = "https://bedrock-runtime-fips.us-east-1.amazonaws.com"
      const auth = middleware({
        integrations: integration({
          credential: Effect.succeed({
            type: "aws-sigv4",
            region,
            accessKeyId: "AKIDEXAMPLE",
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            sessionToken: "session-token",
          }),
          authKind: "sigv4",
        }),
        integration: integrationID,
        region,
        connection: { type: "credential", id, authKind: "sigv4" },
        canonicalOrigin: fips,
        plannedOrigin: fips,
        apiID: "amazon.nova-lite-v1:0",
      })
      const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
      yield* auth(request(`${fips}${path}`), (signed) => Ref.set(observed, signed).pipe(Effect.as(response(signed))))
      const signed = yield* Ref.get(observed)
      expect(signed).toBeDefined()
      if (signed === undefined) return
      const authorization = Option.getOrUndefined(Headers.get(signed.headers, "authorization"))
      // AWS signs the FIPS hostname with the unchanged "bedrock" service name.
      expect(authorization).toContain("/us-east-1/bedrock/aws4_request")
      expect(signed.url).toBe(`${fips}${path}`)
    }),
  )

  it.effect("rejects unsupported bodies and active region changes before physical execution", () =>
    Effect.gen(function* () {
      const physical = yield* Ref.make(0)
      const auth = middleware({
        integrations: integration({
          activeRegion: AwsRegion.make("us-west-2"),
          credential: Effect.die("must not resolve"),
        }),
        integration: integrationID,
        region,
        connection: { type: "credential", id, authKind: "bearer" },
        canonicalOrigin: canonical,
        plannedOrigin: canonical,
        apiID: "amazon.nova-lite-v1:0",
      })
      const handler = (value: HttpClientRequest.HttpClientRequest) =>
        Ref.update(physical, (count) => count + 1).pipe(Effect.as(response(value)))
      expect(yield* auth(HttpClientRequest.post(`${canonical}${path}`), handler).pipe(Effect.flip)).toEqual(
        new Provider.FailureError({ cause: "Provider request body is unsupported" }),
      )
      expect(yield* auth(request(`${canonical}${path}`), handler).pipe(Effect.flip)).toEqual(
        new Provider.FailureError({ cause: "Provider active region changed" }),
      )
      expect(yield* Ref.get(physical)).toBe(0)
    }),
  )
})

function request(url: string) {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.bodyUint8Array(body, "application/json"),
    HttpClientRequest.setHeader("authorization", "Plugin secret"),
  )
}

function integration(input: {
  readonly credential: Effect.Effect<unknown>
  readonly activeRegion?: AwsRegion
  readonly authKind?: "bearer" | "sigv4"
}) {
  return Integration.Service.of({
    get: (integrationID: Integration.ID) =>
      Effect.succeed({ id: integrationID, name: integrationID, methods: [], connections: [] }),
    connection: {
      active: () =>
        Effect.succeed({
          type: "regional-credential",
          id,
          label: "Bedrock",
          authKind: input.authKind ?? "bearer",
          region: input.activeRegion ?? region,
        }),
      resolve: () => input.credential,
    },
  } as unknown as Integration.Interface)
}
