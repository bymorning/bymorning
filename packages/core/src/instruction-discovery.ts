export * as InstructionDiscovery from "./instruction-discovery.js"

import type { InstructionEditor } from "@bymorning/plugin/effect/instruction"
import { Event } from "@bymorning/schema/instruction"
import { Project } from "@bymorning/schema/project"
import { createPatch } from "diff"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Bus } from "./bus.js"
import { Instruction } from "./instruction.js"
import { State } from "./state.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

export class File extends Schema.Class<File>("InstructionDiscovery.File")({
  path: Schema.String,
  content: Schema.String,
  projectID: Schema.optionalKey(Project.ID),
}) {}

const Files = Schema.Array(File)
const key = Instruction.Key.make("core/instructions")

interface Data {
  readonly files: Map<string, Types.DeepMutable<File>>
  available: boolean
}

export interface Interface extends State.Transformable<InstructionEditor> {
  readonly project: boolean
  readonly list: (projectID?: Project.ID) => Effect.Effect<File[] | Instruction.Unavailable>
  readonly load: (projectID?: Project.ID) => Effect.Effect<Instruction.List>
}

export const Options = Schema.Struct({ project: Schema.optional(Schema.Boolean) })
export type Options = typeof Options.Type

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/InstructionDiscovery") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const state = State.create<Data, InstructionEditor>({
        name: "instruction-discovery",
        initial: () => ({ files: new Map(), available: true }),
        editor: (editor) => ({
          list: () => Array.from(editor.files.values()),
          add: (file) => editor.files.set(fileKey(file.path, file.projectID), new File(file) as Types.DeepMutable<File>),
          update: (path, projectID, update) => {
            const current = editor.files.get(fileKey(path, projectID))
            if (!current) return
            update(current)
            current.path = path
            current.projectID = projectID
          },
          remove: (path, projectID) => {
            editor.files.delete(fileKey(path, projectID))
          },
          unavailable: () => {
            editor.available = false
          },
        }),
        notify: () => bus.publish(Event.Updated, {}).pipe(Effect.orDie, Effect.asVoid),
      })

      const list = Effect.fn("InstructionDiscovery.list")(function* (projectID?: Project.ID) {
        const current = state.get()
        if (!current.available) return Instruction.unavailable
        const files = Array.from(current.files.values())
        return [
          ...files.filter((file) => file.projectID === undefined),
          ...files.filter((file) => file.projectID === projectID && file.projectID !== undefined),
        ]
      })

      return Service.of({
        project: options?.project !== false,
        transform: state.transform,
        reload: state.reload,
        list,
        load: Effect.fn("InstructionDiscovery.load")(function* (projectID?: Project.ID) {
          const files = yield* list(projectID)
          return source(Array.isArray(files) && files.length === 0 ? Instruction.removed : files)
        }),
      })
    }),
  )

function source(value: ReadonlyArray<File> | Instruction.Unavailable | Instruction.Removed) {
  return Instruction.make<ReadonlyArray<File>>({
    key,
    codec: Schema.toCodecJson(Files),
    read: Effect.succeed(value),
    render: {
      initial: render,
      changed: renderUpdate,
      removed: () => "Previously loaded instructions no longer apply.",
    },
  })
}

function fileKey(path: string, projectID?: Project.ID) {
  return `${projectID ?? ""}\0${path}`
}

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}

function renderUpdate(previous: ReadonlyArray<File>, current: ReadonlyArray<File>) {
  const changes = Instruction.diffByKey(
    previous,
    current,
    (file) => fileKey(file.path, file.projectID),
    (before, after) => before.content !== after.content,
  )
  return [
    ...changes.removed.map((file) => `The instructions from ${file.path} no longer apply.`),
    ...changes.added.map((file) => `New instructions apply from:\n${render([file])}`),
    ...changes.changed.map(({ previous: before, current: after }) => {
      const patch = createPatch(after.path, before.content, after.content, "", "", { context: 3 })
      const diff = [
        `The instructions from ${after.path} changed. Here's the diff:`,
        "```diff",
        patch.slice(patch.indexOf("@@")).trimEnd(),
        "```",
      ].join("\n")
      const replacement = `The instructions changed:\n${render([after])}`
      return diff.length < replacement.length ? diff : replacement
    }),
  ].join("\n\n")
}

/** Canonical plugin instruction discovery node for one Workspace Bus. */
export const node = makeWorkspaceNode({ service: Service, layer: layer(), deps: [Bus.node] })

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(bus: WorkspaceNode<Bus.Service, E>, options?: Options) =>
  makeWorkspaceNode({ service: Service, layer: layer(options), deps: [bus] })
