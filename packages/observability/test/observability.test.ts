import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { file, fileLogger } from "../src/logging.js"
import { Observability } from "../src/observability.js"
import { resource } from "../src/otlp.js"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=bymorning,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "bymorning",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("keeps built-in identity when environment values conflict", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "bymorning.client=web,service.instance.id=override"

    const telemetry = resource({ client: "cli", version: "1.2.3", channel: "beta" })
    expect(telemetry.attributes["bymorning.client"]).toBe("cli")
    expect(telemetry.attributes["service.instance.id"]).not.toBe("override")
    expect(telemetry.attributes["bymorning.run"]).toMatch(/^[0-9a-f]{8}$/)
  })
})

test("file logger appends correlated structured records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bymorning-observability-test-"))
  const file = path.join(directory, "nested", "bymorning.log")
  await mkdir(path.dirname(file), { recursive: true })
  try {
    await Effect.logInfo("request complete", {
      request: { method: "GET", timing: { duration: 42 } },
    }).pipe(
      Effect.annotateLogs({ session: { id: "session-1" } }),
      Effect.provide(Logger.layer([fileLogger(file, "run-a")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie)),
      Effect.scoped,
      Effect.runPromise,
    )

    const line = (await readFile(file, "utf8")).trim()
    expect(line).toContain("run=run-a")
    expect(line).toContain('message="request complete"')
    expect(line).toContain("request.timing.duration=42")
    expect(line).toContain("session.id=session-1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("falls back to local logging when OTLP initialization fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bymorning-observability-fallback-test-"))
  const xdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = directory
  try {
    await Effect.logInfo("fallback active").pipe(
      Effect.provide(Observability.layer({ endpoint: "://invalid", output: "file", channel: "test" })),
      Effect.scoped,
      Effect.runPromise,
    )
    expect(await readFile(file(false, "test"), "utf8")).toContain('message="fallback active"')
  } finally {
    if (xdgDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = xdgDataHome
    await rm(directory, { recursive: true, force: true })
  }
})

test("exports logs and traces to OTLP HTTP endpoints", async () => {
  const requests: Array<string> = []
  const receiver = createServer((request, response) => {
    requests.push(request.url ?? "")
    request.resume()
    request.on("end", () => {
      response.writeHead(200)
      response.end()
    })
  })
  receiver.listen(0, "127.0.0.1")
  await once(receiver, "listening")
  const address = receiver.address()
  if (address === null || typeof address === "string") throw new Error("OTLP test receiver did not bind a TCP port")

  try {
    await Effect.logInfo("motel compatible").pipe(
      Effect.withSpan("Observability.motelCompatibility"),
      Effect.provide(
        Observability.layer({ endpoint: `http://127.0.0.1:${address.port}`, output: "stderr", channel: "test" }),
      ),
      Effect.scoped,
      Effect.runPromise,
    )
  } finally {
    receiver.close()
    await once(receiver, "close")
  }

  expect(requests).toContain("/v1/logs")
  expect(requests).toContain("/v1/traces")
})
