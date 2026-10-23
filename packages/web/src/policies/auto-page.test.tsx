import type { ApiConfigGetOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { DialogProvider } from "../context/dialog"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { AutoModelPage } from "./auto-page"
import type { CatalogModel } from "./model-picker"

afterEach(() => { cleanup(); toaster.dismiss(); vi.restoreAllMocks() })

const workspaceID = Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWn")
const sol: CatalogModel = { id: "gpt-5.6-sol", name: "GPT-5 Mini", provider: Provider.Bymorning, variants: [] }
const luna: CatalogModel = { id: "gpt-5.6-luna", name: "GPT-5", provider: Provider.Bymorning, variants: [] }
const general = { provider: "auto" as typeof Provider.Bymorning, id: "general" }
const ref = (model: CatalogModel) => ({ provider: model.provider, id: model.id })
const autoRule = {
  match: { model: general },
  to: {
    tiers: [
      { name: "fast", model: ref(sol), description: "Short questions" },
      { name: "deep", model: ref(luna), description: "Hard multi-step work" },
    ],
    default: "fast",
    judge: { model: ref(sol) },
  },
}
const titleRule = { match: { model: general, purpose: ["title"] }, to: ref(sol) }
const config = (routing: ReadonlyArray<unknown> = []): ApiConfigGetOutput => ({
  compaction: { auto: true, keep: { tokens: 40_000 }, buffer: 0.2 }, permissions: [], plugins: [],
  model_policy: { disabled: [], seen: [], initialized: [] },
  routing: routing as ApiConfigGetOutput["routing"],
})

async function choose(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, label: string, option: string) {
  const trigger = within(within(scope).getByRole("group", { name: label })).getByRole("button")
  await user.click(trigger)
  const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!
  const item = within(listbox).getAllByRole("option", { hidden: true }).find((candidate) => candidate.textContent?.includes(option))
  if (!item) throw new Error(`Missing ${option}`)
  await user.click(item)
}

function mount(input: { routing?: ReadonlyArray<unknown>; name?: string; route?: ReturnType<typeof vi.fn> } = {}) {
  let stored = config(input.routing)
  const client = {
    get: vi.fn(async () => stored),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      stored = { ...stored, routing: payload.routing as ApiConfigGetOutput["routing"] }
      return stored
    }),
  }
  const open = vi.fn()
  const back = vi.fn()
  render(() => <><DialogProvider><AutoModelPage
    workspaceID={workspaceID}
    {...(input.name === undefined ? {} : { name: input.name })}
    client={client as never}
    {...(input.route === undefined ? {} : { route: input.route as never })}
    models={() => [sol, luna]}
    open={open}
    back={back}
  /></DialogProvider><Toast.Region /></>)
  return { client, open, back }
}

test("creates an Auto model on its own page", async () => {
  const user = userEvent.setup()
  const { client, open } = mount({ routing: [titleRule], route: vi.fn() })
  await user.type(await screen.findByRole("textbox", { name: "Auto model name" }), "general")
  const tiers = screen.getByRole("region", { name: "Tiers" })
  const first = within(tiers).getByRole("group", { name: "Tier 1" })
  const second = within(tiers).getByRole("group", { name: "Tier 2" })
  await choose(user, first, "Tier 1 model", "GPT-5 Mini")
  await user.type(within(first).getByRole("textbox", { name: "Tier 1 description" }), "Short questions")
  await user.clear(within(second).getByRole("textbox", { name: "Tier 2 name" }))
  await user.type(within(second).getByRole("textbox", { name: "Tier 2 name" }), "deep")
  await choose(user, second, "Tier 2 model", "gpt-5.6-luna")
  await user.type(within(second).getByRole("textbox", { name: "Tier 2 description" }), "Hard multi-step work")
  await choose(user, screen.getByRole("region", { name: "Judge" }), "Judge model", "GPT-5 Mini")
  expect(within(screen.getByRole("region", { name: "Test routing" })).getByRole("button", { name: "Test" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "Create Auto model" }))
  await waitFor(() => expect(open).toHaveBeenCalledWith("general"))
  // A broad Auto model is placed before its narrower title refinement, so the refinement still applies.
  expect(client.update.mock.calls.at(-1)?.[0].routing).toEqual([autoRule, titleRule])
})

test("explains the first problem instead of saving an incomplete Auto model", async () => {
  const user = userEvent.setup()
  const { client } = mount()
  await user.type(await screen.findByRole("textbox", { name: "Auto model name" }), "General!")
  await user.click(screen.getByRole("button", { name: "Create Auto model" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Name the Auto model with lowercase letters")
  expect(client.update).not.toHaveBeenCalled()
})

test("edits tiers in place, reorders them, and only tests saved changes", async () => {
  const user = userEvent.setup()
  const route = vi.fn(async () => ({ model: ref(luna), route: { cause: "judge", rule: 0, tier: "deep" } }))
  const { client } = mount({ routing: [titleRule, autoRule], name: "general", route })
  const save = await screen.findByRole("button", { name: "Save changes" })
  expect(save).toBeDisabled()
  const trial = screen.getByRole("region", { name: "Test routing" })
  await user.type(within(trial).getByRole("textbox", { name: "Sample message" }), "Design a sharded queue")
  await user.click(within(trial).getByRole("button", { name: "Test" }))
  expect(await within(trial).findByRole("status")).toHaveTextContent("→ GPT-5 · tier deep (chosen by the judge)")
  expect(route).toHaveBeenCalledWith({ workspace: workspaceID, model: general, prompt: "Design a sharded queue" })

  await user.click(screen.getByRole("button", { name: "Move tier 2 up" }))
  expect(within(trial).getByText("Save your changes to test them.")).toBeInTheDocument()
  expect(within(trial).getByRole("button", { name: "Test" })).toBeDisabled()
  await user.click(save)
  await waitFor(() => expect(client.update).toHaveBeenCalled())
  const saved = client.update.mock.calls.at(-1)?.[0].routing as ReadonlyArray<typeof autoRule>
  expect(saved[0]).toEqual(titleRule)
  expect(saved[1]?.to.tiers.map((tier) => tier.name)).toEqual(["deep", "fast"])
  expect(await screen.findByText("Auto model saved")).toBeInTheDocument()
  expect(within(trial).getByRole("button", { name: "Test" })).toBeEnabled()
})

test("deletes an Auto model after confirmation and returns to routing", async () => {
  const user = userEvent.setup()
  const { client, back } = mount({ routing: [autoRule, titleRule], name: "general" })
  await user.click(await screen.findByRole("button", { name: "Delete" }))
  const confirm = screen.getByRole("dialog", { name: "Delete Auto model?" })
  expect(confirm).toHaveTextContent("auto/general will fail")
  await user.click(within(confirm).getByRole("button", { name: "Delete" }))
  await waitFor(() => expect(back).toHaveBeenCalled())
  expect(client.update.mock.calls.at(-1)?.[0].routing).toEqual([titleRule])
})

test("reports an Auto model that does not exist", async () => {
  mount({ routing: [autoRule], name: "missing" })
  expect(await screen.findByRole("heading", { name: "Auto model not found" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Model routing" })).toHaveAttribute("href", `/w/${workspaceID}/policies`)
})
