import { createEffect, Match, Show, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

import { GenericTool } from "../basic-tool"
import { ToolErrorCard } from "../tool-error-card"
import "./context-tool"
import "./write-tool"
import "./edit-tool"
import "./skill-tool"
import "./question-tool"
import "./sidebar-tool"
import "./shell-tool"
import "./execute-tool"
import "./subagent-tool"

import { ToolRegistry } from "./tool-registry"

export function ToolDisplay(props: {
  readonly tool: import("../session-model").SessionUI.ToolPart
  readonly onFileOpen: (path: string) => void
  readonly agents?: ReadonlyArray<import("../session-model").SessionUI.AgentPresentation>
  readonly subagentNavigation?: import("../session-model").SessionUI.SubagentNavigation
  readonly actions?: Omit<import("../session-model").SessionUI.TimelineActions, "openFile">
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
}): JSX.Element {
  const failure = () => (props.tool.state.type === "failed" ? props.tool.state : undefined)
  const renderer = () => ToolRegistry.render(props.tool.name)
  const summary = () =>
    props.tool.summary ?? (typeof props.tool.input.path === "string" ? props.tool.input.path : undefined)
  createEffect(() => {
    void props.tool.state
    void props.tool.input
    props.onContentRendered?.()
  })
  return (
    <Switch>
      <Match when={!ToolRegistry.handlesFailure(props.tool.name) && failure()}>
        {(state) => (
          <ToolErrorCard
            name={props.tool.name}
            message={state().message}
            summary={summary()}
            {...(props.open === undefined ? {} : { open: props.open })}
            {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
            {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
          />
        )}
      </Match>
      <Match when={true}>
        <Show
          keyed
          when={renderer()}
          fallback={
            <GenericTool
              tool={props.tool}
              {...(props.open === undefined ? {} : { open: props.open })}
              {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
              {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
            />
          }
        >
          {(component) => (
            <Dynamic
              component={component}
              tool={props.tool}
              agents={props.agents ?? []}
              {...(props.subagentNavigation === undefined ? {} : { subagentNavigation: props.subagentNavigation })}
              actions={{
                openFile: props.onFileOpen,
                sessionHref: props.actions?.sessionHref ?? (() => undefined),
                openSession: props.actions?.openSession ?? (() => undefined),
                sessionStatus: props.actions?.sessionStatus ?? (() => "idle"),
              }}
              {...(props.open === undefined ? {} : { open: props.open })}
              {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
              {...(props.onContentRendered === undefined ? {} : { onContentRendered: props.onContentRendered })}
            />
          )}
        </Show>
      </Match>
    </Switch>
  )
}
