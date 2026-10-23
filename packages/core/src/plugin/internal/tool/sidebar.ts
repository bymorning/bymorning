import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { Effect, Schema } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { ProjectDirectory } from "../../../project-directory.js"

const Input = Schema.Struct({
  open: Schema.Boolean.annotate({ description: "Whether the Right Sidebar should end up open" }),
  path: Schema.optionalKey(
    Schema.String.annotate({
      description: "Project-relative path of the Project File to display. Only meaningful when open is true",
    }),
  ),
})

const Output = Schema.Struct({
  open: Schema.Boolean,
  path: Schema.optionalKey(Schema.String),
})

const description = `Open or close the Right Sidebar beside the conversation, and choose which Project File it displays.

Set open to true with a path to show that file to the user; set open to false to close the sidebar. State the end state you want rather than toggling, because you cannot observe whether the sidebar is currently open.

Paths are Project-relative and must already exist. Write the file first, then call this Tool.

Use this sparingly. Open the sidebar when you have produced or changed a file the user needs to look at to continue, such as a dashboard, report, or document. Do not open it for intermediate files, for files the user did not ask about, or repeatedly for the same file within one turn.`

/** Core Right Sidebar Tool plugin. */
export const SidebarTool = {
  name: "sidebar",
  options: { codemode: false, permission: "sidebar" },
  description,
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      if (input.path === undefined || !input.open) {
        yield* context.permission({
          action: "sidebar",
          resources: ["*"],
          save: ["*"],
          metadata: { projectID: directory.projectID, open: input.open },
        })
        const result = input.open ? "Opened the Right Sidebar" : "Closed the Right Sidebar"
        return { output: { open: input.open }, content: [{ type: "text" as const, text: result }] }
      }
      const path = yield* ProjectDirectory.parse(input.path).pipe(
        Effect.mapError(() => new Tool.Error({ message: `Invalid Project File path: ${input.path}` })),
      )
      const resource = ProjectDirectory.resource(directory.projectID, path)
      yield* context.permission({
        action: "sidebar",
        resources: [resource],
        save: [resource],
        metadata: { projectID: directory.projectID, path, open: true },
      })
      const available = yield* directory.list.pipe(
        Effect.mapError(() => new Tool.Error({ message: `Unable to read the Project Directory` })),
      )
      if (!available.includes(path))
        return yield* new Tool.Error({ message: `Project File not found: ${input.path}` })
      const result = `Showing @${path} in the Right Sidebar`
      return { output: { open: true, path }, content: [{ type: "text" as const, text: result }] }
    }),
}

export const SidebarPlugin = define({
  id: "core.tool.sidebar",
  effect: (context) =>
    bind(SidebarTool).pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
