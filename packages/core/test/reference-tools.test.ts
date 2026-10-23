import { describe, expect, it } from "@effect/vitest"
import { Agent as AgentSchema } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Tool } from "@bymorning/schema/tool"
import { Effect, Ref, Stream } from "effect"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { GlobTool } from "../src/plugin/internal/tool/glob.js"
import { GrepTool } from "../src/plugin/internal/tool/grep.js"
import { ReadTool } from "../src/plugin/internal/tool/read.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { Reference } from "../src/reference.js"
import { SessionInstructions } from "../src/session/instructions.js"

// Leaf reference parsing/content coverage; registered caller isolation lives in integration/session.test.ts.
describe("reference tool private implementations", () => {
  it.effect("reads, globs, and greps logical reference paths", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), "reference-tools-"))),
        (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
      )
      yield* Effect.promise(() => mkdir(path.join(root, "api")))
      yield* Effect.promise(() => writeFile(path.join(root, "api", "index.md"), "alpha\nbeta\n"))
      yield* Effect.promise(() => writeFile(path.join(root, "README.md"), "alpha\n"))
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
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
      const context: Tool.Context = {
        caller: {
          type: "session",
          sessionID: Session.ID.make("00000000-0000-4000-8000-000000000101"),
          agent: AgentSchema.ID.make("build"),
          messageID: MessageID.make("00000000-0000-4000-8000-000000000102"),
          projectID: Project.ID.make("prj_00000000000000000000000101"),
        },
        id: Tool.CallID.make("call_reference"),
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: (request: unknown) => Ref.update(permissions, (items) => [...items, request]),
      }
      const directory = ProjectDirectory.Service.of({
        projectID: Project.ID.make("prj_00000000000000000000000101"),
        list: Effect.die("unused"),
        read: () => Effect.die("unused"),
        write: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        move: () => Effect.die("unused"),
      })
      const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(ProjectDirectory.Service, directory),
          Effect.provideService(Reference.Service, references),
          Effect.provideService(
            SessionInstructions.Service,
            SessionInstructions.Service.of({ load: () => Effect.void }),
          ),
        )

      expect((yield* provide(ReadTool.execute({ path: "reference:docs/api/index.md" }, context))).output).toBe(
        "alpha\nbeta\n",
      )
      expect(
        (yield* provide(GlobTool.execute({ path: "reference:docs", pattern: "**/*.md" }, context))).output,
      ).toEqual(["reference:docs/README.md", "reference:docs/api/index.md"])
      expect((yield* provide(GrepTool.execute({ path: "reference:docs", pattern: "alpha" }, context))).output).toEqual([
        { path: "reference:docs/README.md", line: 1, text: "alpha" },
        { path: "reference:docs/api/index.md", line: 1, text: "alpha" },
      ])
      expect(yield* Ref.get(permissions)).toEqual([
        expect.objectContaining({ action: "read", resources: ["reference:docs"], save: ["reference:docs"] }),
        expect.objectContaining({ action: "glob", resources: ["reference:docs"], save: ["reference:docs"] }),
        expect.objectContaining({ action: "grep", resources: ["reference:docs"], save: ["reference:docs"] }),
      ])
    }),
  )

  it.effect("reports binary Project Files with their size instead of a bare UTF-8 error", () =>
    Effect.gen(function* () {
      const projectID = Project.ID.make("prj_00000000000000000000000101")
      const context: Tool.Context = {
        caller: {
          type: "session",
          sessionID: Session.ID.make("00000000-0000-4000-8000-000000000101"),
          agent: AgentSchema.ID.make("build"),
          messageID: MessageID.make("00000000-0000-4000-8000-000000000102"),
          projectID,
        },
        id: Tool.CallID.make("call_binary"),
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
      }
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe])
      const directory = ProjectDirectory.Service.of({
        projectID,
        list: Effect.succeed([]),
        read: () => Effect.succeed({ content: Stream.make(png) }),
        write: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        move: () => Effect.die("unused"),
      })
      const error = yield* ReadTool.execute({ path: "test.png" }, context).pipe(
        Effect.provideService(ProjectDirectory.Service, directory),
        Effect.provideService(
          Reference.Service,
          Reference.Service.of({
            transform: () => Effect.die("unused"),
            reload: () => Effect.die("unused"),
            list: () => Effect.succeed([]),
          }),
        ),
        Effect.provideService(SessionInstructions.Service, SessionInstructions.Service.of({ load: () => Effect.void })),
        Effect.flip,
      )
      expect(error.message).toContain("binary")
      expect(error.message).toContain("test.png (10 bytes)")
    }),
  )
})
