import { Effect, FileSystem, Option } from "effect"
import { describe, expect, test } from "vitest"
import { write, type Output } from "../src/index.js"

const output = (files: Output["files"]): Output => ({ operations: [], files })

describe("write", () => {
  test("writes formatted files and the generated manifest", async () => {
    const writes: Array<{ readonly path: string; readonly content: string }> = []
    await Effect.runPromise(
      write(output([{ path: "session.ts", content: "export const session={}" }]), "/generated").pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            exists: () => Effect.succeed(false),
            makeDirectory: () => Effect.void,
            writeFileString: (path, content) => {
              writes.push({ path, content })
              return Effect.void
            },
          }),
        ),
      ),
    )

    expect(writes).toEqual([
      { path: "/generated/session.ts", content: "export const session = {}\n" },
      { path: "/generated/.httpapi-codegen.json", content: '["session.ts"]\n' },
    ])
  })

  test("removes only stale files owned by the previous manifest", async () => {
    const removed: Array<string> = []
    await Effect.runPromise(
      write(output([{ path: "session.ts", content: "" }]), "/generated").pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            exists: (path) => Effect.succeed(path.endsWith(".httpapi-codegen.json")),
            makeDirectory: () => Effect.void,
            readFileString: () => Effect.succeed('["old.ts", "session.ts"]'),
            remove: (path) => {
              removed.push(path)
              return Effect.void
            },
            writeFileString: () => Effect.void,
          }),
        ),
      ),
    )
    expect(removed).toEqual(["/generated/old.ts"])
  })

  test("rejects unsafe, duplicate, and symbolic-link output paths", async () => {
    const unsafe = await Effect.runPromise(
      write(output([{ path: "../outside.ts", content: "" }]), "/generated").pipe(
        Effect.flip,
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      ),
    )
    expect(unsafe.reason).toBe("Unsafe output path: ../outside.ts")

    const duplicate = await Effect.runPromise(
      write(
        output([
          { path: "client.ts", content: "" },
          { path: "CLIENT.ts", content: "" },
        ]),
        "/generated",
      ).pipe(Effect.flip, Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({}))),
    )
    expect(duplicate.reason).toBe("Duplicate output path: CLIENT.ts")

    const symbolic = await Effect.runPromise(
      write(output([{ path: "session.ts", content: "" }]), "/generated").pipe(
        Effect.flip,
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            exists: (path) => Effect.succeed(path.endsWith("session.ts")),
            makeDirectory: () => Effect.void,
            stat: () =>
              Effect.succeed({
                type: "SymbolicLink",
                mtime: Option.none(),
                atime: Option.none(),
                birthtime: Option.none(),
                dev: 0,
                ino: Option.none(),
                mode: 0,
                nlink: Option.none(),
                uid: Option.none(),
                gid: Option.none(),
                rdev: Option.none(),
                size: FileSystem.Size(0),
                blksize: Option.none(),
                blocks: Option.none(),
              }),
          }),
        ),
      ),
    )
    expect(symbolic.reason).toBe("Unsafe output path: session.ts")
  })
})
