import type { ApiConfigGetOutput, McpToolsListOutput } from "@bymorning/client"
import * as Agent from "@bymorning/schema/agent"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { DialogProvider } from "../context/dialog"
import type { DataState } from "../context/data"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { PoliciesPage } from "./route"
import type { CatalogModel } from "./model-picker"
import type { RoutingRule } from "./rule-dialog"

afterEach(() => { cleanup(); toaster.dismiss(); vi.restoreAllMocks() })

const workspaceID = Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWn")
const sol: CatalogModel = { id: "gpt-5.6-sol", name: "GPT-5 Mini", provider: Provider.Bymorning, variants: [] }
const luna: CatalogModel = { id: "gpt-5.6-luna", name: "GPT-5", provider: Provider.Bymorning, variants: ["thinking"] }
const tools: McpToolsListOutput = [
  { server: "jira", name: "Jira search", action: "jira_search", description: "Search Jira issues" },
  { server: "filesystem", name: "Read file", action: "read" },
]
const emptyConfig = (overrides?: Partial<ApiConfigGetOutput>): ApiConfigGetOutput => ({
  compaction: { auto: true, keep: { tokens: 40_000 }, buffer: 0.2 }, permissions: [], plugins: ["keep-me"],
  model_policy: { disabled: [], seen: [], initialized: [] }, ...overrides,
})

function mount(input: {
  config?: ApiConfigGetOutput
  models?: () => ReadonlyArray<CatalogModel>
  tools?: McpToolsListOutput | undefined
  toolState?: () => DataState
  toolRetry?: () => void
  registered?: ReadonlyArray<{ readonly action: string; readonly name: string }>
} = {}) {
  let stored = input.config ?? emptyConfig()
  const client = {
    get: vi.fn(async () => stored),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      stored = { ...stored, ...payload, routing: (payload.routing as ApiConfigGetOutput["routing"]) ?? stored.routing }
      delete (stored as { workspace?: unknown }).workspace
      return stored
    }),
  }
  render(() => <><DialogProvider><PoliciesPage
    workspaceID={workspaceID}
    client={client as never}
    models={input.models ?? (() => [sol, luna])}
    tools={{
      list: () => "tools" in input ? input.tools : tools,
      state: input.toolState ?? (() => ({ state: "ready", refreshedAt: 1 })),
      retry: input.toolRetry ?? vi.fn(),
    }}
    registered={() => input.registered}
  /></DialogProvider><Toast.Region /></>)
  return client
}

async function choose(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, label: string, option: string, identity?: string) {
  const trigger = within(within(scope).getByRole("group", { name: label })).getByRole("button")
  await user.click(trigger)
  const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!
  const item = within(listbox).getAllByRole("option", { hidden: true }).find((candidate) =>
    candidate.textContent?.includes(option) && (identity === undefined || candidate.textContent.includes(identity)))
  if (!item) throw new Error(`Missing ${option}`)
  await user.click(item)
}

async function addCondition(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await choose(user, within(dialog).getByRole("region", { name: "When" }), "Add condition", label)
}

async function removeCondition(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await user.click(within(dialog).getByRole("button", { name: `Remove condition: ${label}` }))
}

function menuItem(name: string) {
  return screen.getAllByRole("menuitem", { hidden: true }).find((item) =>
    item.textContent === name && item.closest('[role="menu"]')?.hasAttribute("data-expanded"))!
}

async function controlledMenu(trigger: HTMLElement) {
  let menu: HTMLElement | null = null
  await waitFor(() => {
    menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "")
    expect(menu).toBeInTheDocument()
  })
  return menu!
}

async function chooseAction(user: ReturnType<typeof userEvent.setup>, rule: number, action: string) {
  const trigger = screen.getByRole("button", { name: `Actions for routing rule ${rule}` })
  await user.click(trigger)
  const menu = await controlledMenu(trigger)
  const item = within(menu).getAllByRole("menuitem", { hidden: true }).find((candidate) => candidate.textContent === action)
  if (!item) throw new Error(`Missing ${action}`)
  await user.click(item)
}

test("shows the minimal routing page", async () => {
  mount()
  expect(await screen.findByRole("status", { name: "No routes" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Model routing" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Add route" })).toBeEnabled()
  expect(screen.queryByText(/last matching|next turn/i)).not.toBeInTheDocument()
})

test("adds a model route and preserves writable Config fields", async () => {
  const user = userEvent.setup()
  const config = emptyConfig({ default_agent: Agent.ID.make("build"), default_model: { provider: Provider.Bymorning, id: sol.id }, plugins: ["keep-me", { package: "fixture" }] })
  const client = mount({ config })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  expect(within(when).getByRole("group", { name: "Requested model" })).toBeInTheDocument()
  expect(within(when).queryByRole("group", { name: "After tool" })).not.toBeInTheDocument()
  await choose(user, use, "Model", "GPT-5")
  await choose(user, when, "Model", "GPT-5 Mini")
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  expect(await screen.findByText("Route added")).toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Routes" })).toHaveTextContent("GPT-5 Mini → GPT-5")
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({
    default_agent: "build", plugins: config.plugins,
    routing: [{ match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } }],
  }))
  expect(client.update.mock.calls[0]?.[0]).not.toHaveProperty("default_model")
  expect(client.update.mock.calls[0]?.[0]).not.toHaveProperty("model_policy")
})

test("requires a condition and only expands enabled controls", async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await removeCondition(user, dialog, "Requested model")
  expect(within(dialog).getByRole("button", { name: "Add route" })).toBeDisabled()
  expect(within(when).queryByRole("group", { name: "Model" })).not.toBeInTheDocument()
  await addCondition(user, dialog, "After tool")
  expect(within(when).getByRole("group", { name: "Tool" })).toBeInTheDocument()
  expect(within(dialog).getByRole("button", { name: "Add route" })).toBeEnabled()
})

test("clears the requested-model error once a model is chosen", async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await choose(user, use, "Model", "GPT-5")
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  expect(await within(dialog).findByText("Choose the requested model.")).toBeInTheDocument()
  await choose(user, when, "Model", "GPT-5 Mini")
  expect(within(dialog).queryByText("Choose the requested model.")).not.toBeInTheDocument()
})

test("adds a combined route with variants and a searchable stacked tool", async () => {
  const user = userEvent.setup()
  const client = mount()
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await choose(user, use, "Model", "GPT-5")
  await choose(user, use, "Variant", "thinking")
  await choose(user, when, "Model", "GPT-5")
  await choose(user, when, "Variant", "thinking")
  await addCondition(user, dialog, "After tool")
  await choose(user, when, "Tool", "Jira search")
  expect(screen.queryByRole("combobox", { name: "Search tools" })).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalled())
  expect(client.update.mock.calls.at(-1)?.[0].routing).toEqual([{
    match: { model: { provider: Provider.Bymorning, id: luna.id, variant: "thinking" }, tool: "jira_search" },
    to: { provider: Provider.Bymorning, id: luna.id, variant: "thinking" },
  }])
})

test("names a route on a registered Tool outside the MCP catalog instead of calling it unavailable", async () => {
  mount({
    tools: [],
    registered: [{ action: "write", name: "Write file" }],
    config: emptyConfig({ routing: [
      { match: { tool: "write" }, to: { provider: Provider.Bymorning, id: luna.id } },
      { match: { tool: "retired_action" }, to: { provider: Provider.Bymorning, id: sol.id } },
    ] }),
  })
  const list = await screen.findByRole("list", { name: "Routes" })
  await waitFor(() => expect(list).toHaveTextContent("After Write file → GPT-5"))
  expect(list).toHaveTextContent("After retired_action (unavailable) → GPT-5 Mini")
})

test("keeps unavailable configured values understandable and round-trips them", async () => {
  const user = userEvent.setup()
  const client = mount({ models: () => [luna], tools: [], config: emptyConfig({ routing: [{
    match: { model: { provider: Provider.Bymorning, id: "retired-model" }, tool: "retired_action" }, to: { provider: Provider.Bymorning, id: luna.id },
  }] }) })
  const list = await screen.findByRole("list", { name: "Routes" })
  expect(list).toHaveTextContent("retired-model (bymorning/retired-model) + retired_action (unavailable) completed → GPT-5")
  await user.click(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  await user.click(menuItem("Edit"))
  const edit = screen.getByRole("dialog", { name: "Edit route" })
  expect(within(within(edit).getByRole("region", { name: "When" })).getByRole("button", { name: /retired_action/ })).toBeInTheDocument()
  await user.click(within(edit).getByRole("button", { name: "Save route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalled())
})

test("asks for precedence only for ambiguous conflicts", async () => {
  const user = userEvent.setup()
  const existing = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [existing] }) })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  await choose(user, within(dialog).getByRole("region", { name: "Use" }), "Model", "GPT-5 Mini")
  const when = within(dialog).getByRole("region", { name: "When" })
  await removeCondition(user, dialog, "Requested model")
  await addCondition(user, dialog, "After tool")
  await choose(user, when, "Tool", "Jira search")
  expect(within(dialog).getByRole("radiogroup", { name: "Which should take priority?" })).toBeInTheDocument()
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalled())
  expect(client.update.mock.calls.at(-1)?.[0].routing).toEqual([existing, { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } }])
})

test("refuses a stale-dialog conflict until the fresh precedence is reviewed", async () => {
  const user = userEvent.setup()
  const client = mount()
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await choose(user, use, "Model", "GPT-5 Mini")
  await removeCondition(user, dialog, "Requested model")
  await addCondition(user, dialog, "After tool")
  await choose(user, when, "Tool", "Jira search")

  const fresh = emptyConfig({ routing: [{
    match: { model: { provider: Provider.Bymorning, id: sol.id } },
    to: { provider: Provider.Bymorning, id: luna.id },
  }] })
  client.get.mockResolvedValue(fresh)
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Review the conflict and try again.")
  expect(dialog).toBeInTheDocument()
  expect(client.update).not.toHaveBeenCalled()
  expect(within(dialog).getByRole("button", { name: /Jira search/ })).toBeInTheDocument()
  expect(within(dialog).getByRole("radiogroup", { name: "Which should take priority?" })).toBeInTheDocument()
  expect(within(dialog).getByText("GPT-5 Mini → GPT-5")).toBeInTheDocument()

  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([
    fresh.routing![0],
    { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } },
  ])
})

test("clears a reviewed priority when concurrent conflicts change", async () => {
  const user = userEvent.setup()
  const existing = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const added = { match: { model: { provider: Provider.Bymorning, id: luna.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [existing] }) })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  await choose(user, within(dialog).getByRole("region", { name: "Use" }), "Model", "GPT-5 Mini")
  const when = within(dialog).getByRole("region", { name: "When" })
  await removeCondition(user, dialog, "Requested model")
  await addCondition(user, dialog, "After tool")
  await choose(user, when, "Tool", "Jira search")
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  client.get.mockResolvedValue(emptyConfig({ routing: [existing, added] }))

  await user.click(within(dialog).getByRole("button", { name: "Add route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Review the conflict and try again.")
  expect(client.update).not.toHaveBeenCalled()
  expect(within(dialog).getByRole("radio", { name: "This route" })).not.toBeChecked()
  expect(within(dialog).getByText("GPT-5 Mini → GPT-5")).toBeInTheDocument()
  expect(within(dialog).getByText("GPT-5 → GPT-5")).toBeInTheDocument()
})

test("inserts a strict combined refinement after its broad route", async () => {
  const user = userEvent.setup()
  const broad = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [broad] }) })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await choose(user, use, "Model", "GPT-5 Mini")
  await choose(user, when, "Model", "GPT-5 Mini")
  await addCondition(user, dialog, "After tool")
  await choose(user, when, "Tool", "Jira search")
  expect(within(dialog).queryByRole("radiogroup", { name: "Which should take priority?" })).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalled())
  expect(client.update.mock.calls.at(-1)?.[0].routing).toEqual([broad, {
    match: { model: { provider: Provider.Bymorning, id: sol.id }, tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id },
  }])
})

test("keeps an unsatisfiable mixed-priority route open for review", async () => {
  const user = userEvent.setup()
  const combined = {
    match: { model: { provider: Provider.Bymorning, id: sol.id }, tool: "jira_search" },
    to: { provider: Provider.Bymorning, id: luna.id },
  } as const
  const read = { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [combined, read] }) })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await choose(user, use, "Model", "GPT-5 Mini")
  await choose(user, when, "Model", "GPT-5 Mini")
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))

  await user.click(within(dialog).getByRole("button", { name: "Add route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("This priority conflicts with route specificity. Review the routes and try again.")
  expect(dialog).toBeInTheDocument()
  expect(client.update).not.toHaveBeenCalled()
  expect(within(dialog).getByRole("radiogroup", { name: "Which should take priority?" })).toBeInTheDocument()
})

test("preserves an unchanged edited route's position", async () => {
  const user = userEvent.setup()
  const routing: Array<RoutingRule> = [
    { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: luna.id } },
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } },
  ]
  const client = mount({ config: emptyConfig({ routing: routing as ApiConfigGetOutput["routing"] }) })
  await screen.findByRole("list", { name: "Routes" })
  await user.click(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  await user.click(menuItem("Edit"))
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  await user.click(within(dialog).getByRole("button", { name: "Save route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual(routing)
})

test("edits a uniquely matched route after it moves", async () => {
  const user = userEvent.setup()
  const original = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const other = { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const client = mount({ config: emptyConfig({ routing: [other, original] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Edit")
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  await user.click(within(dialog).getByRole("radio", { name: "Existing route" }))
  client.get.mockResolvedValue(emptyConfig({ routing: [original, other] }))

  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([original, other])
})

test("edits a later duplicate matcher instead of rejecting the first matcher's destination", async () => {
  const user = userEvent.setup()
  const routing: Array<RoutingRule> = [
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: sol.id } },
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } },
  ]
  const client = mount({ config: emptyConfig({ routing: routing as ApiConfigGetOutput["routing"] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Edit")

  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  expect(within(dialog).getByRole("radiogroup", { name: "Which should take priority?" })).toBeInTheDocument()
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual(routing)
})

test("reviews duplicate matchers as precedence conflicts and saves the selected winner", async () => {
  const user = userEvent.setup()
  const first = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const second = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [first, second] }) })

  await user.click(await screen.findByRole("button", { name: "1 routing conflict needs review" }))
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  expect(within(dialog).getByText("GPT-5 Mini → GPT-5")).toBeInTheDocument()
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([second, first])
})

test("restores focus to the conflict review button after closing Edit", async () => {
  const user = userEvent.setup()
  mount({ config: emptyConfig({ routing: [
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } },
    { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } },
  ] }) })
  const review = await screen.findByRole("button", { name: "1 routing conflict needs review" })

  await user.click(review)
  await user.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).not.toBeInTheDocument())
  await waitFor(() => expect(review).toHaveFocus())
})

test("edits the selected occurrence of exact duplicate rules", async () => {
  const user = userEvent.setup()
  const duplicate = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [duplicate, duplicate] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Edit")

  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  await choose(user, within(dialog).getByRole("region", { name: "Use" }), "Model", "GPT-5 Mini")
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([
    duplicate,
    { match: { model: duplicate.match.model }, to: { provider: Provider.Bymorning, id: sol.id } },
  ])
})

test("saves the selected exact duplicate when the opening snapshot is unchanged", async () => {
  const user = userEvent.setup()
  const duplicate = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [duplicate, duplicate] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Edit")

  await user.click(within(screen.getByRole("dialog", { name: "Edit route" })).getByRole("button", { name: "Save route" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([duplicate, duplicate])
})

test("rejects an edit when reordered exact duplicates make the occurrence ambiguous", async () => {
  const user = userEvent.setup()
  const duplicate = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const other = { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const client = mount({ config: emptyConfig({ routing: [other, duplicate, duplicate] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 3, "Edit")
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  client.get.mockResolvedValue(emptyConfig({ routing: [duplicate, duplicate, other] }))

  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Reopen the route and try again.")
  expect(client.update).not.toHaveBeenCalled()
})

test("rejects an edit when the route was concurrently deleted", async () => {
  const user = userEvent.setup()
  const original = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [original] }) })
  await screen.findByRole("list", { name: "Routes" })
  await user.click(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  await user.click(menuItem("Edit"))
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  client.get.mockResolvedValue(emptyConfig({ routing: [] }))

  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Reopen the route and try again.")
  expect(dialog).toBeInTheDocument()
  expect(client.update).not.toHaveBeenCalled()
  expect(within(within(dialog).getByRole("region", { name: "Use" })).getByRole("button", { name: /GPT-5/ })).toBeInTheDocument()
  expect(within(within(dialog).getByRole("region", { name: "When" })).getByRole("button", { name: /GPT-5 Mini/ })).toBeInTheDocument()

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).not.toBeInTheDocument())
  expect(screen.getByRole("status", { name: "No routes" })).toBeInTheDocument()
})

test("rejects an edit when the route was concurrently replaced", async () => {
  const user = userEvent.setup()
  const original = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const replacement = { match: { model: original.match.model }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const client = mount({ config: emptyConfig({ routing: [original] }) })
  await screen.findByRole("list", { name: "Routes" })
  await user.click(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  await user.click(menuItem("Edit"))
  const dialog = screen.getByRole("dialog", { name: "Edit route" })
  client.get.mockResolvedValue(emptyConfig({ routing: [replacement] }))

  await user.click(within(dialog).getByRole("button", { name: "Save route" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Reopen the route and try again.")
  expect(dialog).toBeInTheDocument()
  expect(client.update).not.toHaveBeenCalled()
  expect(within(within(dialog).getByRole("region", { name: "Use" })).getByRole("button", { name: /GPT-5/ })).toBeInTheDocument()
  expect(within(within(dialog).getByRole("region", { name: "When" })).getByRole("button", { name: /GPT-5 Mini/ })).toBeInTheDocument()

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).not.toBeInTheDocument())
  expect(screen.getByRole("list", { name: "Routes" })).toHaveTextContent("GPT-5 Mini → GPT-5 Mini")
})

test("removes a uniquely matched route after it moves", async () => {
  const user = userEvent.setup()
  const original = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const other = { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const client = mount({ config: emptyConfig({ routing: [other, original] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Remove")
  const dialog = screen.getByRole("dialog", { name: "Remove route?" })
  client.get.mockResolvedValue(emptyConfig({ routing: [original, other] }))

  await user.click(within(dialog).getByRole("button", { name: "Remove" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([other])
})

test("rejects removal when reordered duplicates make the occurrence ambiguous", async () => {
  const user = userEvent.setup()
  const duplicate = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const other = { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: sol.id } } as const
  const client = mount({ config: emptyConfig({ routing: [other, duplicate, duplicate] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 3, "Remove")
  const dialog = screen.getByRole("dialog", { name: "Remove route?" })
  client.get.mockResolvedValue(emptyConfig({ routing: [duplicate, duplicate, other] }))

  await user.click(within(dialog).getByRole("button", { name: "Remove" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Routing changed. Reopen the route and try again.")
  expect(client.update).not.toHaveBeenCalled()
  expect(dialog).toBeInTheDocument()
})

test("removes the selected occurrence when the opening duplicate snapshot is unchanged", async () => {
  const user = userEvent.setup()
  const duplicate = { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } } as const
  const client = mount({ config: emptyConfig({ routing: [duplicate, duplicate] }) })
  await screen.findByRole("list", { name: "Routes" })
  await chooseAction(user, 2, "Remove")

  await user.click(within(screen.getByRole("dialog", { name: "Remove route?" })).getByRole("button", { name: "Remove" }))

  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0].routing).toEqual([duplicate])
})

test("Escape closes the nested Model picker and restores its trigger focus", async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const use = within(dialog).getByRole("region", { name: "Use" })
  const trigger = within(within(use).getByRole("group", { name: "Model" })).getByRole("button")
  await user.click(trigger)
  expect(trigger).toHaveAttribute("aria-expanded", "true")
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Search models" })).toHaveFocus())

  await user.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument())
  expect(dialog).toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

test("shows conflict review and edit/remove actions", async () => {
  const user = userEvent.setup()
  const client = mount({ config: emptyConfig({ routing: [
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } },
    { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } },
  ] }) })
  const review = await screen.findByRole("button", { name: "1 routing conflict needs review" })
  await user.click(review)
  expect(screen.getByRole("dialog", { name: "Edit route" })).toHaveTextContent("Which should take priority?")
  await user.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).not.toBeInTheDocument())
  // Wait for the settled focus restore so its timer cannot steal focus from the menu opened next.
  await waitFor(() => expect(review).toHaveFocus())
  const actions = screen.getByRole("button", { name: "Actions for routing rule 1" })
  await user.click(actions)
  const menu = await controlledMenu(actions)
  expect(within(menu).queryByRole("menuitem", { name: "Move up", hidden: true })).not.toBeInTheDocument()
  await user.click(menuItem("Remove"))
  const confirm = screen.getByRole("dialog", { name: "Remove route?" })
  expect(confirm).toHaveTextContent("GPT-5 Mini → GPT-5")
  await user.click(within(confirm).getByRole("button", { name: "Remove" }))
  expect(await screen.findByText("Route removed")).toBeInTheDocument()
  expect(client.update).toHaveBeenLastCalledWith(expect.objectContaining({ routing: [{ match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } }] }))
})

test("pluralizes multiple routing conflicts", async () => {
  mount({ config: emptyConfig({ routing: [
    { match: { model: { provider: Provider.Bymorning, id: sol.id } }, to: { provider: Provider.Bymorning, id: luna.id } },
    { match: { tool: "jira_search" }, to: { provider: Provider.Bymorning, id: sol.id } },
    { match: { tool: "read" }, to: { provider: Provider.Bymorning, id: luna.id } },
  ] }) })

  expect(await screen.findByRole("button", { name: "2 routing conflicts need review" })).toBeInTheDocument()
})

test("retries a failed tool catalog without blocking model routes", async () => {
  const user = userEvent.setup()
  const retry = vi.fn()
  mount({ tools: undefined, toolState: () => ({ state: "error", message: "tool catalog offline" }), toolRetry: retry })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  const when = within(dialog).getByRole("region", { name: "When" })
  await addCondition(user, dialog, "After tool")
  await user.click(within(dialog).getByRole("button", { name: "Try again" }))
  expect(retry).toHaveBeenCalledOnce()
})

test("lists Auto models separately and keeps config-only tier rules read-only", async () => {
  const user = userEvent.setup()
  const tiers = {
    tiers: [{ name: "fast", model: { provider: Provider.Bymorning, id: sol.id }, description: "Short questions" }],
    default: "fast",
    judge: { model: { provider: Provider.Bymorning, id: sol.id } },
  }
  mount({ config: emptyConfig({ routing: [
    { match: { model: { provider: "auto" as typeof Provider.Bymorning, id: "general" } }, to: tiers },
    { match: { text: { pattern: "urgent" } }, to: tiers },
  ] as ApiConfigGetOutput["routing"] }) })
  const auto = await screen.findByRole("list", { name: "Auto models" })
  expect(within(auto).getByRole("link", { name: /auto\/general/ })).toHaveAttribute("href", `/w/${workspaceID}/policies/auto/general`)
  expect(auto).toHaveTextContent("fast: GPT-5 Mini · judged by GPT-5 Mini")
  const routes = screen.getByRole("list", { name: "Routes" })
  expect(routes).toHaveTextContent("Edit this tiered rule in Workspace configuration.")
  await user.click(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  const menu = await controlledMenu(screen.getByRole("button", { name: "Actions for routing rule 1" }))
  expect(within(menu).queryByRole("menuitem", { name: "Edit", hidden: true })).not.toBeInTheDocument()
})

test("matches a requested Auto model through the same model picker", async () => {
  const user = userEvent.setup()
  const client = mount({ config: emptyConfig({ routing: [
    { match: { model: { provider: "auto" as typeof Provider.Bymorning, id: "general" } }, to: {
      tiers: [{ name: "fast", model: { provider: Provider.Bymorning, id: sol.id }, description: "Short questions" }],
      default: "fast",
      judge: { model: { provider: Provider.Bymorning, id: sol.id } },
    } },
  ] as ApiConfigGetOutput["routing"] }) })
  await user.click(await screen.findByRole("button", { name: "Add route" }))
  const dialog = screen.getByRole("dialog", { name: "Add route" })
  await choose(user, within(dialog).getByRole("region", { name: "When" }), "Model", "Auto · general")
  await choose(user, within(dialog).getByRole("region", { name: "Use" }), "Model", "GPT-5", luna.id)
  await user.click(within(dialog).getByRole("radio", { name: "This route" }))
  await user.click(within(dialog).getByRole("button", { name: "Add route" }))
  await waitFor(() => expect(client.update).toHaveBeenCalled())
  expect((client.update.mock.calls.at(-1)?.[0].routing as ReadonlyArray<unknown>).at(-1)).toEqual({
    match: { model: { provider: "auto", id: "general" } },
    to: { provider: Provider.Bymorning, id: luna.id },
  })
})
