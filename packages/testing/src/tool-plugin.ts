import { Plugin } from "@bymorning/plugin"
import { Effect, Schema } from "effect"

/** A real host HTTP leaf, shared by Session and inbound MCP callers. */
export default Plugin.define({
  id: "test.tool",
  async setup(context) {
    const endpoint = Schema.decodeUnknownSync(Schema.String)(context.options.endpoint)
    const origin = new URL(endpoint)
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") throw new Error("Expected fixture endpoint")
    await context.tool.transform((editor) => {
      editor.add({
        name: "fixture_http",
        description: "Read the local verification endpoint directly",
        input: Schema.Struct({}),
        output: Schema.String,
        options: { codemode: false, permission: "fixture.http" },
        async execute(_input, invocation) {
          await invocation.permission({ action: "fixture.http", resources: [origin.origin] })
          const response = await fetch(new URL("/value", origin), { redirect: "error" })
          if (!response.ok) throw new Error("Fixture HTTP request failed")
          const output = await response.text()
          return { output, content: output }
        },
      })
      editor.add({
        name: "fixture_code",
        description: "Read the local verification endpoint through CodeMode",
        input: Schema.Struct({}),
        output: Schema.String,
        options: { codemode: true, permission: "fixture.http" },
        async execute(_input, invocation) {
          await invocation.permission({ action: "fixture.http", resources: [origin.origin] })
          const response = await fetch(new URL("/value", origin), { redirect: "error" })
          if (!response.ok) throw new Error("Fixture HTTP request failed")
          const output = await response.text()
          return { output, content: output }
        },
      })
      editor.add({
        name: "fixture_elicit",
        description: "Ask for one confirmation before reading the fixture endpoint",
        input: Schema.Struct({}),
        output: Schema.String,
        options: { codemode: false, permission: "fixture.http" },
        async execute(_input, invocation) {
          const elicitation = await Effect.runPromise(invocation.elicit({
            mode: "form",
            title: "Confirm fixture request",
            message: "Read the fixture endpoint?",
            fields: [{ key: "confirm", type: "boolean", required: true }],
          }))
          if (elicitation.action !== "accept" || elicitation.answer.confirm !== true) throw new Error("Fixture request declined")
          await invocation.permission({ action: "fixture.http", resources: [origin.origin] })
          const response = await fetch(new URL("/value", origin), { redirect: "error" })
          if (!response.ok) throw new Error("Fixture HTTP request failed")
          const output = await response.text()
          return { output, content: output }
        },
      })
      editor.add({
        name: "fixture_echo",
        description: "Return the size of the supplied text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.String,
        options: { codemode: false, permission: "fixture.http" },
        async execute(input, invocation) {
          await invocation.permission({ action: "fixture.http", resources: [origin.origin] })
          const output = `received ${input.text.length} characters`
          return { output, content: output }
        },
      })
      editor.add({
        name: "fixture_elicit_twice",
        description: "Ask twice before reading the fixture endpoint",
        input: Schema.Struct({}),
        output: Schema.String,
        options: { codemode: false, permission: "fixture.http" },
        async execute(_input, invocation) {
          for (const key of ["first", "second"] as const) {
            const elicitation = await Effect.runPromise(invocation.elicit({
              mode: "form",
              title: `Confirm ${key}`,
              message: `Confirm ${key} fixture request?`,
              fields: [{ key, type: "boolean", required: true }],
            }))
            if (elicitation.action !== "accept" || elicitation.answer[key] !== true) throw new Error("Fixture request declined")
          }
          await invocation.permission({ action: "fixture.http", resources: [origin.origin] })
          const response = await fetch(new URL("/value", origin), { redirect: "error" })
          if (!response.ok) throw new Error("Fixture HTTP request failed")
          const output = await response.text()
          return { output, content: output }
        },
      })
    })
  },
})
