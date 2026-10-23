import type { McpToolsListOutput } from "@bymorning/client"
import type { Accessor, JSX } from "solid-js"

import { Button } from "../ui/components/button"
import { Icon } from "../ui/components/icon"
import { SearchableSelectPopover } from "../ui/components/select-dialog"

type Tool = McpToolsListOutput[number]
/** Searchable picker for workspace MCP tools, keyed by the persisted tool action. */
export function ToolPicker(props: {
  readonly tools: Accessor<ReadonlyArray<Tool>>
  readonly current: Accessor<string | undefined>
  readonly pending: Accessor<boolean>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (action: string) => void
  readonly label?: string
  readonly searchLabel?: string
  readonly placeholder?: string
}): JSX.Element {
  const selected = () => props.tools().find((tool) => tool.action === props.current())
  const identity = () => {
    const tool = selected()
    if (tool === undefined) return props.current() ?? (props.placeholder ?? "Choose a tool")
    return `${tool.name} (${tool.server}/${tool.action})`
  }

  return (
    <SearchableSelectPopover
      label={props.label ?? "Completed tool"}
      searchLabel={props.searchLabel ?? "Search tools"}
      emptyLabel="No tools found"
      size="large"
      optionLayout="stacked"
      placement="bottom-start"
      open={props.open}
      onOpenChange={props.onOpenChange}
      model={{
        options: () => props.tools().map((tool) => ({
            key: tool.action,
            label: tool.name,
            accessibleLabel: `${tool.name}, ${tool.server}/${tool.action}`,
            group: tool.server,
            description: `${tool.server}/${tool.action}${tool.description ? ` — ${tool.description}` : " — No description provided"}`,
          })),
        current: props.current,
        pending: props.pending,
        select: props.onSelect,
      }}
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          type="button"
          variant="outline"
          disabled={props.pending()}
          data-slot="searchable-choice-trigger"
          aria-label={`${props.label ?? "Completed tool"}, ${identity()}`}
        >
          <span data-slot="searchable-choice-trigger-label">{identity()}</span>
          <Icon name="chevron-down" size="small" />
        </Button>
      )}
    />
  )
}
