import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { skillLibrary } from "./library/catalog"
import { skillLibraryCategories } from "./library/model"
import { SkillLibraryDialog } from "./library-dialog"

afterEach(cleanup)

function mount(options: { readonly existing?: ReadonlySet<string>; readonly add?: () => Promise<unknown> } = {}) {
  const add = options.add ?? vi.fn().mockResolvedValue({})
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <SkillLibraryDialog existing={() => options.existing ?? new Set()} add={add} />
          ))
        }
      >
        Open
      </button>
    )
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <DialogProvider>
        <Harness />
      </DialogProvider>
    </QueryClientProvider>
  ))
  return { add, user: userEvent.setup() }
}

it("groups every suggested skill under its category", async () => {
  const { user } = mount()
  await user.click(screen.getByRole("button", { name: "Open" }))

  for (const category of skillLibraryCategories) {
    expect(await screen.findByRole("heading", { name: category.label })).toBeVisible()
  }
  for (const entry of skillLibrary) {
    expect(screen.getByText(entry.name)).toBeVisible()
  }
})

it("adds a skill with its full instructions and marks it added", async () => {
  const entry = skillLibrary[0]!
  const { add, user } = mount()
  await user.click(screen.getByRole("button", { name: "Open" }))

  const item = (await screen.findByText(entry.name)).closest('[data-slot="skill-library-item"]')!
  await user.click(within(item as HTMLElement).getByRole("button", { name: `Add ${entry.name}` }))

  await waitFor(() =>
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ id: entry.id, name: entry.name, instructions: entry.instructions }),
    ),
  )
  expect(await within(item as HTMLElement).findByText("Added")).toBeVisible()
})

it("shows a skill the workspace already has as added", async () => {
  const entry = skillLibrary[0]!
  const { add, user } = mount({ existing: new Set([entry.name]) })
  await user.click(screen.getByRole("button", { name: "Open" }))

  const item = (await screen.findByText(entry.name)).closest('[data-slot="skill-library-item"]')!
  expect(within(item as HTMLElement).getByText("Added")).toBeVisible()
  expect(within(item as HTMLElement).queryByRole("button", { name: `Add ${entry.name}` })).not.toBeInTheDocument()
  expect(add).not.toHaveBeenCalled()
})

it("reports a failed add without marking the skill added", async () => {
  const entry = skillLibrary[0]!
  const { user } = mount({ add: vi.fn().mockRejectedValue(new Error("nope")) })
  await user.click(screen.getByRole("button", { name: "Open" }))

  const item = (await screen.findByText(entry.name)).closest('[data-slot="skill-library-item"]')!
  await user.click(within(item as HTMLElement).getByRole("button", { name: `Add ${entry.name}` }))

  expect(await within(item as HTMLElement).findByRole("alert")).toHaveTextContent("Could not add this skill")
  expect(within(item as HTMLElement).getByRole("button", { name: `Add ${entry.name}` })).toBeVisible()
})
