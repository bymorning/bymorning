import type { ShareView } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { ID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Schema } from "effect"
import { Share } from "@bymorning/schema/share"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"

const sessionID = Schema.decodeUnknownSync(Session.ID)("00000000-0000-4000-8000-000000000001")
const token = Schema.decodeUnknownSync(Share.Token)("11111111-1111-4111-8111-111111111111")
const model = { id: "gpt-5.6-sol", provider: Provider.Name.make("bymorning") }
const workspaceID = Workspace.ID.make("wrk_sharefixture0000000001")

const messageID = (suffix: string) =>
  Schema.decodeUnknownSync(ID)(`00000000-0000-4000-8000-${suffix.padStart(12, "0")}`)

const at = (iso: string) => new Date(iso)

const usage = (input: number, output: number, reasoning: number, cost: number) => ({
  cost,
  costComplete: true as const,
  tokens: { input, output, reasoning, cache: { read: 12_288, write: 0 } },
})

const completedTool = (
  id: string,
  name: string,
  input: { readonly [key: string]: string },
  output: string,
  created: Date,
  completed: Date,
) => ({
  type: "tool" as const,
  id,
  name,
  state: {
    status: "completed" as const,
    input,
    content: [{ type: "text" as const, text: output }],
    result: output,
  },
  time: { created, ran: created, completed },
})

/** Short Share view for route tests. */
export const shareFixture = (): ShareView => ({
  workspaceID,
  sessionID,
  title: "Shared conversation",
  token,
  createdAt: at("2026-01-01T00:00:00.000Z"),
  messages: [
    {
      id: messageID("2"),
      sessionID,
      sequence: 1,
      createdAt: at("2026-01-01T00:00:00.000Z"),
      type: "user",
      text: "Share this conversation",
      admittedSequence: 1,
    },
    {
      id: messageID("3"),
      sessionID,
      sequence: 2,
      createdAt: at("2026-01-01T00:00:08.000Z"),
      type: "assistant",
      agent: Agent.DefaultID,
      model,
      content: [{ type: "text", id: "answer", text: "Share it at /s/wrk_example/11111111-1111-4111-8111-111111111111" }],
      time: { created: at("2026-01-01T00:00:08.000Z"), completed: at("2026-01-01T00:00:12.000Z") },
      usage: usage(0, 0, 0, 0),
    },
  ],
})

/** Multi-turn Share view that looks like a real Session. */
export const shareConversation = (): ShareView => {
  const first = at("2026-03-12T14:02:00.000Z")
  const readAt = at("2026-03-12T14:02:06.000Z")
  const firstDone = at("2026-03-12T14:02:24.000Z")
  const second = at("2026-03-12T14:03:10.000Z")
  const writeAt = at("2026-03-12T14:03:16.000Z")
  const secondDone = at("2026-03-12T14:03:41.000Z")
  return {
    workspaceID,
    sessionID,
    title: "Login hangs after 2FA",
    token,
    createdAt: first,
    messages: [
      {
        id: messageID("2"),
        sessionID,
        sequence: 1,
        createdAt: first,
        type: "user",
        text: "The login page hangs after 2FA. Can you look at `packages/web/src/login/route.tsx`?",
        admittedSequence: 1,
      },
      {
        id: messageID("3"),
        sessionID,
        sequence: 2,
        createdAt: readAt,
        type: "assistant",
        agent: Agent.DefaultID,
        model,
        content: [
          completedTool(
            "read-login",
            "read",
            { path: "packages/web/src/login/route.tsx" },
            [
              "export function LoginRoute() {",
              "  const controller = new AbortController()",
              "  void client.auth.poll({ signal: controller.signal })",
              "  return <LoginForm />",
              "}",
            ].join("\n"),
            readAt,
            at("2026-03-12T14:02:08.000Z"),
          ),
          {
            type: "text",
            id: "diagnose",
            text: [
              "The poll starts, but nothing aborts it when the route unmounts. After 2FA the request keeps running in the background and the page looks hung.",
              "",
              "Abort on cleanup:",
              "",
              "```tsx",
              "onCleanup(() => controller.abort())",
              "```",
              "",
              "I can add a test for the leave-page case next.",
            ].join("\n"),
          },
        ],
        time: { created: readAt, completed: firstDone },
        usage: usage(1842, 486, 220, 0.041),
      },
      {
        id: messageID("4"),
        sessionID,
        sequence: 3,
        createdAt: second,
        type: "user",
        text: "Yes — abort the in-flight request when the user leaves, then add a test.",
        admittedSequence: 3,
      },
      {
        id: messageID("5"),
        sessionID,
        sequence: 4,
        createdAt: writeAt,
        type: "assistant",
        agent: Agent.DefaultID,
        model,
        content: [
          completedTool(
            "write-test",
            "write",
            {
              path: "packages/web/src/login/route.test.tsx",
              content: [
                'it("aborts the 2FA poll when the route unmounts", async () => {',
                "  const view = render(() => <LoginRoute />)",
                "  view.unmount()",
                "  expect(abort).toHaveBeenCalled()",
                "})",
              ].join("\n"),
            },
            "Wrote packages/web/src/login/route.test.tsx",
            writeAt,
            at("2026-03-12T14:03:19.000Z"),
          ),
          {
            type: "text",
            id: "wrap-up",
            text: [
              "Done. Leaving the login page now cancels the 2FA poll.",
              "",
              "- `onCleanup` aborts the controller",
              "- the test unmounts the route and asserts `abort` ran",
              "",
              "The hang after 2FA should be gone.",
            ].join("\n"),
          },
        ],
        time: { created: writeAt, completed: secondDone },
        usage: usage(2104, 612, 80, 0.038),
      },
    ],
  }
}
