import { createMemo, Show, type JSX } from "solid-js"

import { TextShimmer } from "../../../../ui/components/text-shimmer"
import { useI18n } from "../../../../ui/context/i18n"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import { ToolIcon } from "./tool-icon"

const marker = "__BYMORNING_LOADED_SKILL__"

function SkillTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const name = createMemo(() => skillName(props))
  const running = () => props.tool.state.type === "running"
  const parts = createMemo(() => i18n.t("ui.tool.loadedSkill").split(marker))

  return (
    <Show
      when={name()}
      fallback={
        <div data-component="tool-loaded-item">
          <ToolIcon name="skill" />
          <TextShimmer text={i18n.t("ui.tool.skill")} active={running()} />
        </div>
      }
    >
      {(name) => (
        <div data-component="tool-loaded-item" aria-label={parts().join(name())}>
          <ToolIcon name="skill" />
          <span data-slot="tool-loaded-label" aria-hidden="true">
            {parts()[0]?.trim()}
          </span>
          <span data-slot="tool-loaded-value" aria-hidden="true">
            <TextShimmer as="span" text={name()} active={running()} />
          </span>
          <Show when={parts()[1]?.trim()}>
            {(suffix) => (
              <span data-slot="tool-loaded-kind" aria-hidden="true">
                {suffix()}
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}

function skillName({ tool }: ToolRendererProps) {
  if (typeof tool.metadata.name === "string") return tool.metadata.name
  const result = tool.state.type === "succeeded" ? tool.state.result : undefined
  if (result && typeof result === "object" && "name" in result && typeof result.name === "string") return result.name
  return typeof tool.input.id === "string"
    ? tool.input.id
    : typeof tool.input.name === "string"
      ? tool.input.name
      : undefined
}

ToolRegistry.register({ name: "skill", render: SkillTool })
