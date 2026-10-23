import { type JSX } from "solid-js"

import { useTheme, type ColorScheme } from "../ui/theme"
import { CommandDialog } from "./command-dialog"

const MODES: ReadonlyArray<{ readonly id: ColorScheme; readonly name: string }> = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
]

/** Select the persisted color-mode policy. */
export function SchemeDialog(): JSX.Element {
  const theme = useTheme()
  return (
    <CommandDialog
      label="Choose color mode"
      placeholder="Search color modes"
      options={() =>
        MODES.map((mode) => ({
          id: `color.${mode.id}`,
          title: mode.name,
          category: "Color mode",
          onSelect: () => theme.setColorScheme(mode.id),
        }))
      }
    />
  )
}
