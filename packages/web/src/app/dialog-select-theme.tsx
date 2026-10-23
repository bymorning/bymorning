import { type JSX } from "solid-js"

import { useTheme } from "../ui/theme"
import { CommandDialog } from "./command-dialog"

/** Select one bundled visual theme. */
export function ThemeDialog(): JSX.Element {
  const theme = useTheme()
  return (
    <CommandDialog
      label="Choose theme"
      placeholder="Search themes"
      options={() =>
        theme.ids().map((id) => ({
          id: `theme.${id}`,
          title: theme.name(id) ?? id,
          category: "Theme",
          onSelect: () => theme.setTheme(id),
        }))
      }
    />
  )
}
