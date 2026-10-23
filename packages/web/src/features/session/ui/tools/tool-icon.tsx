import { Icon } from "../../../../ui/components/icon"
import "./tool-icon.css"

const icons = new Map<string, Parameters<typeof Icon>[0]["name"]>([
  ["execute", "console"],
  ["shell", "console"],
  ["read", "file-read"],
  ["edit", "file-edit"],
  ["write", "file-edit"],
  ["apply_patch", "file-edit"],
  ["patch", "file-edit"],
  ["websearch", "web"],
  ["webfetch", "web"],
  ["glob", "central-search"],
  ["grep", "central-search"],
  ["list", "central-folder-open"],
  ["skill", "central-agent-skills"],
  ["subagent", "central-agents"],
  ["task", "central-agents"],
  ["question", "central-sessions"],
  ["sidebar", "sidebar-right"],
])

export function ToolIcon(props: { readonly name: string }) {
  return (
    <span data-slot="tool-icon" aria-hidden="true">
      <Icon name={icons.get(props.name) ?? "central-toolbox"} />
    </span>
  )
}
