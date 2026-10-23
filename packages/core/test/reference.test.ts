import { LayerNode } from "@bymorning/util/effect/layer-node"
import { describe, expect, it } from "@effect/vitest"
import { Event } from "@bymorning/schema/event"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Effect, Layer, Stream } from "effect"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import path from "node:path"
import { Bus } from "../src/bus.js"
import { Reference } from "../src/reference.js"
import { AppProcess } from "../src/util/process.js"

const execute = promisify(execFile)
const bus = Layer.succeed(
  Bus.Service,
  Bus.Service.of({
    publish: ((definition: Event.Definition, data: unknown) =>
      Effect.succeed({ id: Event.ID.make(crypto.randomUUID()), created: Date.now(), type: definition.type, data })) as Bus.Interface["publish"],
        subscribe: (() => Effect.succeed(Stream.empty)) as Bus.Subscribe,
  }),
)
const processes = LayerNode.compile(AppProcess.node)

describe("Reference", () => {
  it.effect("materializes local and Git references", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "reference-")))
      const repository = path.join(root, "repository")
      yield* Effect.promise(async () => {
        await execute("git", ["init", repository])
        await writeFile(path.join(repository, "README.md"), "reference")
        await execute("git", ["-C", repository, "add", "."])
        await execute("git", ["-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])
      })

      const references = yield* Reference.Service
      yield* references.transform((editor) => {
        editor.add("local", { type: "local", path: AbsolutePath.make(repository) })
        editor.add("git", { type: "git", repository })
      })
      const listed = yield* references.list()
      expect(listed.map((reference) => reference.name)).toEqual(["local", "git"])
      // The Git reference materializes in the background; wait for its file, not for a fixed delay.
      const readme = path.join(listed[1]!.path, "README.md")
      const content = yield* Effect.promise(async () => {
        const deadline = Date.now() + 20_000
        while (true) {
          try {
            return await readFile(readme, "utf8")
          } catch (cause) {
            if (Date.now() > deadline) throw cause
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        }
      })
      expect(content).toBe("reference")
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Reference.layer(path.join(tmpdir(), `references-${crypto.randomUUID()}`)).pipe(
          Layer.provide(Layer.merge(bus, processes)),
        ),
      ),
    ),
  )
})
