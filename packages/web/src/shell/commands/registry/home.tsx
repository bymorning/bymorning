import { useLocation, useNavigate } from "@solidjs/router"
import type { Accessor } from "solid-js"

export function createHomeCommands(workspaceID: Accessor<string | undefined>) {
  const location = useLocation()
  const navigate = useNavigate()
  return () => {
    const current = workspaceID()
    if (current === undefined) return []
    return [
      {
        id: "home.toggle",
        title: "Home",
        category: "View",
        hidden: true,
        onSelect: () => {
          const home = `/w/${current}`
          if (location.pathname !== home) navigate(home)
        },
      },
    ]
  }
}
