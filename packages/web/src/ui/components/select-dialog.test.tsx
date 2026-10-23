import { cleanup, render, screen } from "@solidjs/testing-library"
import { afterEach, expect, it } from "vitest"

import { Button } from "./button"
import { SearchableSelectPopover } from "./select-dialog"

afterEach(cleanup)

it("opens with the first rendered option active, not the first by label", async () => {
  // "Alpha" sorts first by label but its group (zeta) renders last.
  const options = [
    { key: "zeta/alpha", label: "Alpha", group: "zeta" },
    { key: "beta/bravo", label: "Bravo", group: "beta" },
  ]
  render(() => (
    <SearchableSelectPopover
      open
      onOpenChange={() => undefined}
      label="Model"
      model={{ options: () => options, current: () => undefined, pending: () => false, select: () => undefined }}
      trigger={(props) => <Button {...props}>Choose</Button>}
    />
  ))
  const search = await screen.findByRole("combobox", { name: "Search models" })
  expect(search).toHaveAttribute("aria-activedescendant", expect.stringContaining(encodeURIComponent("beta/bravo")))
})
