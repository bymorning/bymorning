import { Session } from "@bymorning/schema/session"
import { AgentSchema } from "@bymorning/schema/agent"
import { MessageSchema } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Workspace } from "@bymorning/schema/workspace"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Form } from "../src/form.js"
import { Input, QuestionTool, execute, toField, toModelContent } from "../src/plugin/internal/tool/question.js"
import { Tool } from "../src/tool.js"
import { Bus } from "../src/bus.js"
import { Database } from "../src/database.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"

const definition = (forms: Form.Interface) => ({
  ...QuestionTool,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    QuestionTool.execute(input, context).pipe(Effect.provideService(Form.Service, forms)),
})

describe("question tool", () => {
  it.effect("decodes provider item-wrapped options into the canonical question input", () =>
    Effect.gen(function* () {
      const options = [{ label: "Technology / AI", description: "Write about technology." }]
      const prompt = { question: "What should the essay cover?", header: "Essay topic", options }
      const decoded = yield* Schema.decodeUnknownEffect(Input)({
        questions: [{ ...prompt, options: { item: options } }],
      })
      expect(decoded).toEqual({ questions: [prompt] })
      expect(yield* Schema.decodeUnknownEffect(Input)(decoded)).toEqual({ questions: [prompt] })
    }),
  )

  it.effect("opens a real Form in a fresh session and resumes the tool after an answer", () => {
    const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
    const forms = Form.layer.pipe(Layer.provide(bus))
    return Effect.gen(function* () {
      const events = yield* Bus.Service
      const forms = yield* Form.Service
      const tools = yield* Tool.make
      const tool = definition(forms)
      yield* tools.transform((editor) => editor.add(tool))
      const snapshot = yield* tools.snapshot()
      const created = yield* events.subscribe([SessionEvent.FormCreated])
      const sessionID = Session.ID.make(crypto.randomUUID())
      const input = {
        questions: [
          {
            question: "Choose an essay topic",
            header: "Topic",
            options: { item: [{ label: "Technology", description: "Write about technology" }] },
          },
        ],
      }
      const context: Tool.Context = {
        caller: {
          type: "session",
          sessionID,
          agent: AgentSchema.ID.make("build"),
          messageID: MessageSchema.ID.make(crypto.randomUUID()),
          projectID: Project.ID.make("prj_00000000000000000000000921"),
        },
        id: Tool.CallID.make("call_question"),
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
      }
      const run = yield* snapshot
        .execute({
          call: ToolCallPart.make({ id: context.id, name: tool.name, input }),
          context,
        })
        .pipe(Effect.forkChild)
      const event = yield* created.pipe(Stream.runHead)
      if (Option.isNone(event)) return yield* Effect.die(new Error("Form was not published"))
      const form = event.value.data
      expect(form.sessionID).toBe(sessionID)
      expect(form.fields[0]).toMatchObject({ type: "string", options: [{ value: "Technology" }] })
      yield* forms.reply({ id: form.id, answer: { q0: "Technology" } })
      expect((yield* Fiber.join(run)).output).toEqual({ answers: [["Technology"]] })
      expect(yield* forms.list({ sessionID })).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(bus, forms, PluginHooks.layer)))
  })

  it("still rejects malformed option wrappers and invalid options", () => {
    for (const options of [{ item: "invalid" }, { item: [{ label: "Missing description" }] }, { items: [] }, null]) {
      expect(() =>
        Schema.decodeUnknownSync(Input)({
          questions: [{ question: "Choose", header: "Choice", options }],
        }),
      ).toThrow()
    }
  })

  it("rejects empty input and maps single and multiple prompts to custom Form fields", () => {
    expect(() => Schema.decodeUnknownSync(Input)({ questions: [] })).toThrow()
    const single = {
      question: "Choose one",
      header: "Choice",
      options: [{ label: "A", description: "First" }],
    }
    const multiple = {
      question: "Choose many",
      header: "Choices",
      options: [{ label: "B", description: "Second" }],
      multiple: true as const,
    }
    expect(toField(single, 0)).toEqual({
      key: "q0",
      title: "Choice",
      description: "Choose one",
      type: "string",
      options: [{ value: "A", label: "A", description: "First" }],
      custom: true,
    })
    expect(toField(multiple, 1)).toMatchObject({ key: "q1", type: "multiselect", custom: true })
    expect(toModelContent([single, multiple], [["A"], ["B"]])).toBe(
      'User has answered your questions: "Choose one"="A", "Choose many"="B". You can now continue with the user\'s answers in mind.',
    )
  })

  it.effect("checks permission before asking and maps answers", () => {
    const order: string[] = []
    const forms = Form.Service.of({
      create: () => Effect.die("unused"),
      ask: (input) => {
        order.push("ask")
        expect(input.fields.map((field) => field.type)).toEqual(["string", "multiselect"])
        return Effect.succeed({ status: "answered", answer: { q0: "A", q1: ["B"] } })
      },
      get: () => Effect.die("unused"),
      list: () => Effect.succeed([]),
      state: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
    })
    return execute(
      Schema.decodeUnknownSync(Input)({
        questions: [
          { question: "Choose one", header: "Choice", options: [{ label: "A", description: "First" }] },
          {
            question: "Choose many",
            header: "Choices",
            options: [{ label: "B", description: "Second" }],
            multiple: true,
          },
        ],
      }),
      {
        id: Tool.CallID.make("call"),
        caller: {
          type: "session",
          sessionID: Session.ID.make(crypto.randomUUID()),
          agent: AgentSchema.ID.make("build"),
          messageID: MessageSchema.ID.make(crypto.randomUUID()),
          projectID: Project.ID.make("prj_00000000000000000000000921"),
        },
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: () => Effect.sync(() => order.push("permission")),
      },
    ).pipe(
      Effect.provideService(Form.Service, forms),
      Effect.tap((result) => Effect.sync(() => expect(result.output.answers).toEqual([["A"], ["B"]]))),
      Effect.tap(() => Effect.sync(() => expect(order).toEqual(["permission", "ask"]))),
    )
  })

  it.effect("uses the rejection defect tunnel when a Form is cancelled", () => {
    const forms = Form.Service.of({
      create: () => Effect.die("unused"),
      ask: () => Effect.succeed({ status: "cancelled" }),
      get: () => Effect.die("unused"),
      list: () => Effect.succeed([]),
      state: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
    })
    return execute(
      Schema.decodeUnknownSync(Input)({
        questions: [{ question: "Continue?", header: "Continue", options: [] }],
      }),
      {
        id: Tool.CallID.make("call"),
        caller: {
          type: "session",
          sessionID: Session.ID.make(crypto.randomUUID()),
          agent: AgentSchema.ID.make("build"),
          messageID: MessageSchema.ID.make(crypto.randomUUID()),
          projectID: Project.ID.make("prj_00000000000000000000000921"),
        },
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
      },
    ).pipe(
      Effect.provideService(Form.Service, forms),
      Effect.exit,
      Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true))),
      Effect.asVoid,
    )
  })
})
