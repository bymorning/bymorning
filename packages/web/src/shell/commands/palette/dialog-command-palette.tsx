import { CommandDialog } from "../../../app/command-dialog"
import { useData } from "../../../context/data"
import { useServer } from "../../../runtime/server/runtime"
import { useSDK } from "../../../context/sdk"
import { useWorkspace } from "../../../context/workspace"
import { sessionLabel } from "../../../utils/session-title"
import { sessionRouteHref } from "../../../workspace-route-paths"
import { useNavigate } from "@solidjs/router"
import { type CommandOption, useCommand } from "../context"

const archives = new Set(["session.archive", "session.unarchive"])

export function DialogCommandPalette() {
  const command = useCommand()
  const data = useData()
  const server = useServer()
  const { client } = useSDK()
  const navigate = useNavigate()
  const workspace = useWorkspace()
  return (
    <CommandDialog
      label="Commands"
      placeholder="Search commands"
      hint="Search commands, sessions, and workspaces"
      options={() =>
        command
          .options()
          .filter((item) => !item.disabled && !item.hidden && item.id !== "command.palette")
          // Archiving must never be the preselected default, so it sorts after every other command.
          .toSorted((left, right) => Number(archives.has(left.id)) - Number(archives.has(right.id)))
      }
      search={async (query, signal) => {
        const page = await client.session.list(
          { workspace: workspace.current().id, search: query, parentID: null, archived: false, limit: 50 },
          { signal },
        )
        const projects = new Map(server.data.project.list().map((project) => [project.id, project] as const))
        return page.data.flatMap((session): CommandOption[] => {
          const project = projects.get(session.projectID)
          if (!project) return []
          return [
            {
              id: `session:${session.id}`,
              title: sessionLabel(session),
              description: project.name ?? "Untitled",
              meta: relativeTime(session.updatedAt),
              category: "Sessions",
              onSelect: () => {
                data.session.view(session.id)
                navigate(sessionRouteHref(workspace.current().id, session.id))
              },
            },
          ]
        })
      }}
    />
  )
}

function relativeTime(value: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - value.valueOf()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
