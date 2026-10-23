import { describe, expect, it } from "@effect/vitest"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Effect, Option } from "effect"
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Reference } from "../src/reference.js"
import { ReferenceDirectory } from "../src/reference-directory.js"

describe("ReferenceDirectory", () => {
  it("parses logical reference paths", () => {
    expect(Option.getOrUndefined(ReferenceDirectory.parse("reference:docs"))).toEqual({ name: "docs", path: "" })
    expect(Option.getOrUndefined(ReferenceDirectory.parse("reference:docs/api/index.md"))).toEqual({
      name: "docs",
      path: "api/index.md",
    })
    for (const input of ["reference:", "reference:docs/../secret", "reference:docs\\file", "reference:docs/a\0b"])
      expect(Option.isNone(ReferenceDirectory.parse(input))).toBe(true)
  })

  it.effect("resolves contained files and rejects symlink escapes", () =>
    Effect.gen(function* () {
      // realpath: macOS reports the temp directory through a /private symlink.
      const base = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "reference-directory-")).then((dir) => realpath(dir)))
      const root = path.join(base, "root")
      const outside = path.join(base, "outside.txt")
      yield* Effect.promise(() => mkdir(path.join(root, "api"), { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(root, "api", "index.md"), "docs"))
      yield* Effect.promise(() => writeFile(outside, "secret"))
      yield* Effect.promise(() => symlink(outside, path.join(root, "escape")))
      const references = Reference.Service.of({
        transform: () => Effect.die("unused"),
        reload: () => Effect.die("unused"),
        list: () =>
          Effect.succeed([
            {
              name: "docs",
              path: AbsolutePath.make(root),
              source: { type: "local", path: AbsolutePath.make(root) },
            },
          ]),
      })
      expect(yield* ReferenceDirectory.resolve(references, "reference:docs/api/index.md")).toMatchObject({
        name: "docs",
        root,
        absolute: path.join(root, "api", "index.md"),
      })
      expect((yield* Effect.flip(ReferenceDirectory.resolve(references, "reference:docs/missing")))._tag).toBe(
        "ReferenceDirectory.NotFoundError",
      )
      expect((yield* Effect.flip(ReferenceDirectory.resolve(references, "reference:docs/escape")))._tag).toBe(
        "ReferenceDirectory.InvalidPathError",
      )
    }),
  )
})
