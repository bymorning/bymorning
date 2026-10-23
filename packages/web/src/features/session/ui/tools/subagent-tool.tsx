import { Show, type JSX } from "solid-js"

import { Loader } from "../../../../ui/components/loader"
import { useI18n } from "../../../../ui/context/i18n"
import { ToolRegistry, type ToolRendererProps } from "./tool-registry"
import { ToolIcon } from "./tool-icon"
import "./subagent-tool.css"

function SubagentTool(props: ToolRendererProps): JSX.Element {
  const i18n = useI18n()
  const description = () =>
    typeof props.tool.input.description === "string" && props.tool.input.description.length > 0
      ? props.tool.input.description
      : i18n.t("ui.tool.subagent.delegatedTask")
  const childID = () => {
    const metadata = props.tool.metadata.sessionID
    if (typeof metadata === "string" && metadata.length > 0) return metadata
    const navigation = props.subagentNavigation
    if (!navigation) return undefined
    const task = typeof props.tool.input.description === "string" ? props.tool.input.description : ""
    return navigation.sessions
      .filter((session) => session.parentID === navigation.parentID && session.archivedAt === undefined)
      .filter((session) => (task ? session.title.startsWith(task) : true))
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0]?.id
  }
  const agentID = () => (typeof props.tool.input.agent === "string" ? props.tool.input.agent : undefined)
  const agent = () => props.agents.find((candidate) => candidate.id === agentID())
  const agentName = () => agent()?.name ?? agentID() ?? i18n.t("ui.tool.subagent.defaultAgent")
  const background = () => props.tool.state.type === "succeeded" && props.tool.metadata.status === "running"
  const pending = () => {
    if (props.tool.inputStreaming || props.tool.state.type === "running") return true
    if (props.tool.state.type !== "succeeded") return false
    const sessionID = childID()
    return sessionID !== undefined && props.actions.sessionStatus(sessionID) === "running"
  }
  const terminal = () => {
    if (props.tool.state.type === "failed") return props.tool.state.message
    if (props.tool.state.type === "interrupted" || props.tool.state.type === "stopped")
      return i18n.t("ui.tool.subagent.cancelled")
    return undefined
  }
  const status = () => {
    if (props.tool.state.type === "failed")
      return i18n.t("ui.tool.subagent.error", { message: props.tool.state.message })
    if (terminal()) return terminal()
    if (background() && pending()) return i18n.t("ui.tool.subagent.runningBackground")
    if (pending()) return i18n.t("ui.tool.subagent.running")
    return i18n.t("ui.tool.subagent.completed")
  }
  const label = () =>
    i18n.t("ui.tool.subagent.label", {
      agent: agentName(),
      description: description(),
      status: status() ?? i18n.t("ui.tool.subagent.completed"),
    })
  const href = () => {
    const sessionID = childID()
    return sessionID ? props.actions.sessionHref(sessionID) : undefined
  }
  const open = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return
    const sessionID = childID()
    if (!sessionID) return
    event.preventDefault()
    props.actions.openSession(sessionID)
  }

  return (
    <Show
      when={!props.tool.inputStreaming}
      fallback={
        <div
          data-component="subagent-tool"
          data-compact
          role="status"
          aria-label={i18n.t("ui.tool.subagent.delegating")}
        >
          <Loader width={14} height={14} />
          <span data-slot="subagent-tool-delegating">{i18n.t("ui.tool.subagent.delegating")}</span>
        </div>
      }
    >
      <Show
        when={href()}
        fallback={
          <div
            data-component="subagent-tool"
            data-background={background() ? "true" : undefined}
            data-pending={pending() ? "true" : undefined}
            aria-label={label()}
          >
            {content()}
          </div>
        }
      >
        {(target) => (
          <a
            href={target()}
            data-component="subagent-tool"
            data-background={background() ? "true" : undefined}
            data-pending={pending() ? "true" : undefined}
            aria-label={label()}
            onClick={open}
          >
            {content()}
          </a>
        )}
      </Show>
    </Show>
  )

  function content() {
    return (
      <>
        <Show when={pending()} fallback={<ToolIcon name="subagent" />}>
          <span data-slot="subagent-tool-status" aria-hidden="true">
            <Loader width={14} height={14} />
          </span>
        </Show>
        <span data-slot="subagent-tool-content">
          <span data-slot="subagent-tool-agent">{agentName()}</span>
          <span data-slot="subagent-tool-description">{description()}</span>
          <Show when={background()}>
            <span data-slot="subagent-tool-background">{i18n.t("ui.tool.subagent.backgroundSuffix")}</span>
          </Show>
          <Show when={terminal()}>{(status) => <span data-slot="subagent-tool-terminal">{status()}</span>}</Show>
        </span>
        <Show when={childID()}>
          <svg data-slot="subagent-tool-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M6.5 5 9.5 8l-3 3" fill="none" stroke="currentColor" stroke-linecap="round" />
          </svg>
        </Show>
      </>
    )
  }
}

ToolRegistry.register({ name: "subagent", render: SubagentTool, handlesFailure: true })
