import { expect, test as base, type Locator, type Page } from "@playwright/test"
import * as Message from "@bymorning/schema/message"
import * as Project from "@bymorning/schema/project"
import * as Session from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { Schema } from "effect"
import path from "node:path"

import { trackPageErrors } from "../utils/errors"
import { mockGateway } from "../utils/mock-gateway"

const createdAt = "2026-08-18T14:30:00.000Z"
const workspace = Schema.decodeUnknownSync(Workspace.Info)({ id: "wrk_acme", name: "Acme Studio", status: "active" })
const secondWorkspace = Schema.decodeUnknownSync(Workspace.Info)({
  id: "wrk_northstar",
  name: "Northstar Labs",
  status: "active",
})
const project = Schema.decodeUnknownSync(Project.Info)({
  id: "prj_01K2Y8W9F3ABCD5EFGHJKMNPQR",
  name: "Atlas Web",
  time_created: 1_755_526_200_000,
  time_updated: 1_755_612_600_000,
})
const session = Schema.decodeUnknownSync(Session.Info)({
  id: "76b7b644-1dd2-4eb1-a40e-f6155e954721",
  projectID: project.id,
  title: "Polish onboarding flow",
  agent: "build",
  model: { id: "aurora-3-2", provider: "vertex" },
  createdAt,
  updatedAt: createdAt,
})
const detail = Session.Detail.make({
  ...session,
  usage: {
    cost: 1.84,
    costComplete: true,
    tokens: { input: 18_420, output: 3_860, reasoning: 1_240, cache: { read: 6_400, write: 800 } },
  },
})

const providers = [provider("vertex", "Vertex AI", 3), provider("openai", "OpenAI", 2)]
const models = [
  model("aurora-3-2", "Aurora 3.2", "vertex", 3, 15, 0.3, 3.75, 64_000),
  model("nova-5", "Nova 5", "openai", 1.25, 10, 0.125, 2.5, 32_000),
]
const aggregate = {
  invocations: 1_284,
  cost: 428.62,
  costComplete: true,
  tokens: {
    total: 8_420_000,
    input: 5_600_000,
    output: 1_480_000,
    reasoning: 620_000,
    cache: { read: 640_000, write: 80_000 },
  },
}
const tools = [
  { name: "bash", action: "tool.execute", description: "Run a shell command.", effect: "ask" },
  { name: "read_file", action: "read_file", description: "Read a workspace file.", effect: "allow" },
  { name: "websearch", action: "websearch", description: "Search the web.", effect: "allow" },
  { name: "linear_get_issue", action: "linear_get_issue", description: "Get an issue by identifier.", effect: "allow" },
  { name: "linear_list_issues", action: "linear_list_issues", description: "List team issues.", effect: "ask" },
]

const messageBase = {
  sessionID: session.id,
  createdAt,
}
const usage = {
  cost: 0.42,
  costComplete: true,
  tokens: { input: 1_240, output: 486, reasoning: 128, cache: { read: 320, write: 0 } },
}
const timelineMessages = encodeMessages([
  {
    ...messageBase,
    id: "11111111-1111-4111-8111-111111111111",
    type: "user",
    sequence: 1,
    admittedSequence: 1,
    text: "Inspect and update the onboarding flow.",
  },
  {
    ...messageBase,
    id: "22222222-2222-4222-8222-222222222222",
    type: "assistant",
    sequence: 2,
    agent: "build",
    model: { id: "aurora-3-2", provider: "vertex" },
    finish: "tool-calls",
    time: { created: createdAt, completed: "2026-08-18T14:30:02.400Z" },
    usage,
    content: [
      completedTool(
        "read-onboarding",
        "read",
        { path: "src/pages/onboarding.tsx", offset: 20, limit: 80 },
        {
          content: [{ type: "text", text: "export function Onboarding() {}" }],
        },
      ),
      completedTool(
        "grep-onboarding",
        "grep",
        { path: "src", pattern: "Onboarding", include: "*.tsx" },
        {
          metadata: { matches: 4 },
          content: [{ type: "text", text: "src/pages/onboarding.tsx:12" }],
        },
      ),
      completedTool(
        "patch-onboarding",
        "patch",
        {},
        {
          metadata: {
            files: [
              {
                file: "src/pages/onboarding.tsx",
                patch: "@@ -1 +1 @@\n-old onboarding\n+new onboarding",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
              {
                file: "src/styles/onboarding.css",
                patch: "+[data-page=onboarding] { display: grid; }",
                additions: 1,
                deletions: 0,
                status: "added",
              },
            ],
          },
          content: [{ type: "text", text: "Updated two files." }],
        },
      ),
      completedTool(
        "check-onboarding",
        "shell",
        { command: "bun typecheck", description: "bun typecheck" },
        {
          content: [{ type: "text", text: "Checked 184 files." }],
        },
      ),
      {
        type: "tool",
        id: "deploy-onboarding",
        name: "deploy",
        state: {
          status: "error",
          input: { target: "preview", description: "preview environment" },
          error: { _tag: "SessionError.ToolError", message: "Preview environment is unavailable" },
        },
        time: { created: createdAt, ran: createdAt, completed: "2026-08-18T14:30:02.400Z" },
      },
    ],
  },
])
const subagentMessages = encodeMessages([
  {
    ...messageBase,
    id: "33333333-3333-4333-8333-333333333333",
    type: "user",
    sequence: 1,
    admittedSequence: 1,
    text: "Delegate the independent accessibility checks.",
  },
  {
    ...messageBase,
    id: "44444444-4444-4444-8444-444444444444",
    type: "assistant",
    sequence: 2,
    agent: "build",
    model: { id: "aurora-3-2", provider: "vertex" },
    finish: "tool-calls",
    time: { created: createdAt, completed: "2026-08-18T14:30:03.200Z" },
    usage,
    content: [
      runningTool("subagent-navigation", "subagent", { agent: "explore", description: "Review navigation semantics" }),
      completedTool(
        "subagent-layout",
        "subagent",
        { agent: "explore", description: "Validate responsive layout" },
        {
          metadata: { sessionID: "55555555-5555-4555-8555-555555555555", status: "completed" },
          content: [{ type: "text", text: "Responsive layout is clear at supported widths." }],
        },
      ),
      completedTool(
        "subagent-keyboard",
        "subagent",
        { agent: "explore", description: "Audit keyboard flow" },
        {
          metadata: { sessionID: "66666666-6666-4666-8666-666666666666", status: "running" },
          content: [{ type: "text", text: "Continuing keyboard checks in the background." }],
        },
      ),
      {
        type: "tool",
        id: "subagent-contrast",
        name: "subagent",
        state: {
          status: "error",
          input: { agent: "explore", description: "Compare contrast baseline" },
          metadata: { sessionID: "77777777-7777-4777-8777-777777777777" },
          error: { _tag: "SessionError.ProviderError", message: "Provider quota exhausted" },
        },
        time: { created: createdAt, ran: createdAt, completed: "2026-08-18T14:30:03.200Z" },
      },
    ],
  },
])

export const docsFixture = {
  workspace,
  secondWorkspace,
  project,
  session,
  timelineMessages,
  subagentMessages,
  responses: {
    workspaces: Schema.encodeSync(Schema.Array(Workspace.Info))([workspace, secondWorkspace]),
    projects: Schema.encodeSync(Schema.Array(Project.Info))([project]),
    sessions: Schema.encodeSync(Session.Page)({ data: [session] }),
    session: Schema.encodeSync(Session.Detail)(detail),
    active: {},
    messages: { data: [], cursor: {} },
    projectFiles: {
      paths: ["README.md", "package.json", "src/app.tsx", "src/components/button.tsx", "src/styles/theme.css"],
    },
    skills: [
      {
        id: "release-notes",
        name: "Release notes",
        description: "Draft clear release notes from merged changes.",
        instructions: "# Release notes",
      },
      {
        id: "accessibility-review",
        name: "Accessibility review",
        description: "Review interfaces against accessibility guidance.",
        instructions: "# Accessibility review",
      },
      {
        id: "incident-summary",
        name: "Incident summary",
        description: "Turn incident timelines into concise summaries.",
        instructions: "# Incident summary",
      },
    ],
    users: {
      role: "admin",
      members: [
        { email: "maya@acme.example", role: "admin", status: "active" },
        { email: "jonah@acme.example", role: "admin", status: "active" },
        { email: "priya@acme.example", role: "member", status: "active" },
        { email: "sam@acme.example", role: "member", status: "pending" },
      ],
    },
    providers,
    models,
    agents: [
      {
        id: "explore",
        name: "Explorer",
        instructions: "Inspect the requested area and report focused findings.",
        description: "Fast codebase exploration.",
        mode: "subagent",
        hidden: false,
        color: "#2563eb",
        steps: 12,
        permissions: [],
      },
    ],
    tools,
    usage: {
      days: 30,
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T00:00:00.000Z",
      total: aggregate,
      daily: [
        { date: "2026-08-27", usage: { ...aggregate, invocations: 242 } },
        { date: "2026-08-28", usage: { ...aggregate, invocations: 310 } },
        { date: "2026-08-29", usage: { ...aggregate, invocations: 276 } },
        { date: "2026-08-30", usage: { ...aggregate, invocations: 228 } },
        { date: "2026-08-31", usage: { ...aggregate, invocations: 228 } },
      ],
      models: [
        { model: "vertex/aurora-3-2", usage: aggregate },
        { model: "openai/nova-5", usage: { ...aggregate, invocations: 418, cost: 96.4 } },
      ],
      users: [
        { userID: "usr_maya", usage: aggregate },
        { userID: "usr_jonah", usage: { ...aggregate, invocations: 386, cost: 104.2 } },
      ],
    },
    integrations: [],
    mcpServers: [{ name: "linear", url: "https://mcp.linear.app/mcp", enabled: true, status: "connected" }],
    mcpTools: [
      {
        server: "linear",
        name: "search_issues",
        action: "linear_search_issues",
        description: "Search Linear issues",
      },
    ],
    toolPermissions: [
      { name: "linear_search_issues", action: "linear_search_issues", description: "Search Linear issues", effect: "ask" },
    ],
    websearchProviders: [],
    permissions: [],
  },
}

type Fixtures = {
  readonly gateway: Awaited<ReturnType<typeof mockGateway>>
  readonly errors: string[]
  readonly capture: (name: string, target?: Locator) => Promise<void>
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
    await page.addInitScript(() => {
      localStorage.setItem("bymorning-color-scheme", "light")
      localStorage.setItem("bymorning-theme-id", "ink")
    })
    await use(page)
  },
  errors: async ({ page }, use) => use(trackPageErrors(page)),
  gateway: async ({ page }, use) => {
    await use(
      await mockGateway(page, { workspaceID: workspace.id, sessionID: session.id, responses: docsFixture.responses }),
    )
  },
  capture: async ({ page, gateway, errors }, use) => {
    await use(async (name, target) => {
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440)
      const options = {
        path: path.resolve("../docs/public/images/docs", name),
        animations: "disabled" as const,
        caret: "hide" as const,
      }
      if (target) await target.screenshot(options)
      else await page.screenshot({ ...options, fullPage: true })
      await expect.poll(gateway.unexpected).toEqual([])
      expect(errors).toEqual([])
    })
  },
})

export { expect }

function provider(name: string, displayName: string, modelCount: number) {
  return {
    info: { name, displayName, api: "https://api.acme.example", format: "openai", status: "enabled" },
    integration: {
      id: name,
      name: displayName,
      methods: [],
      connections: [{ type: "env", name: `${name.toUpperCase()}_API_KEY` }],
    },
    connected: true,
    connectionCount: 1,
    modelCount,
  }
}

function model(
  id: string,
  name: string,
  provider: string,
  input: number,
  output: number,
  read: number,
  write: number,
  limit: number,
) {
  return {
    info: {
      id,
      apiID: id,
      name,
      provider,
      description: "",
      status: "active",
      releaseDate: "2026-06-01",
      lastUpdated: "2026-08-01",
      openWeights: false,
      capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: [], output: [] },
      variants: [],
      limit: { context: 200_000, output: limit },
      cost: { input, output, cache: { read, write } },
    },
    enabled: true,
    isPreferredDefault: id === "aurora-3-2",
    isEffectiveDefault: id === "aurora-3-2",
  }
}

function encodeMessages(data: ReadonlyArray<unknown>) {
  return {
    data: Schema.encodeSync(Schema.Array(Message.Message))(Schema.decodeUnknownSync(Schema.Array(Message.Message))(data)),
    cursor: {},
  }
}

function completedTool(
  id: string,
  name: string,
  input: Record<string, unknown>,
  detail: {
    readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
    readonly metadata?: Record<string, unknown>
  },
) {
  return {
    type: "tool" as const,
    id,
    name,
    state: { status: "completed" as const, input, ...detail },
    time: { created: createdAt, ran: createdAt, completed: "2026-08-18T14:30:02.400Z" },
  }
}

function runningTool(id: string, name: string, input: Record<string, unknown>) {
  return {
    type: "tool" as const,
    id,
    name,
    state: { status: "running" as const, input },
    time: { created: createdAt, ran: createdAt },
  }
}
