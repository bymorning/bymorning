import type { SessionInfo } from "@bymorning/client"
import { createMemo } from "solid-js"

import { modelOptionKey, type ModelOption } from "../../utils/model-option"
import { createVisibility } from "../../utils/model-visibility"
import type { Controller as SessionController } from "./session-controller"
import type { SessionSelection } from "./ui/session-selection"

type Source = {
  readonly data: Pick<SessionController["data"], "detail" | "agents" | "models">
  readonly selection: SessionController["selection"]
}

export function createController(source: Source): SessionSelection.Model {
  const visibility = createVisibility(() => source.data.models() ?? [])
  const detail = () => {
    const state = source.data.detail()
    return state.state === "ready" ? state.data : undefined
  }
  const agents = () => {
    return (source.data.agents() ?? [])
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({ key: agent.id, label: agent.name, value: agent.id }))
  }
  const models = () => {
    return (source.data.models() ?? []).map((model) => ({
      key: modelOptionKey(model),
      label: model.name,
      value: model,
    }))
  }
  const currentModel = () =>
    models().find((item) => item.value.provider === detail()?.model.provider && item.value.id === detail()?.model.id)
  const variants = createMemo(() =>
    ["default", ...new Set(currentModel()?.value.variants ?? [])].map((variant, index) => ({
      key: `variant:${index}`,
      label: variant === "default" ? "Default" : variant,
      value: variant,
    })),
  )
  const switchModel = (item: ModelOption, variant = detail()?.model.variant) => {
    visibility.set(item, true)
    const selectedVariant = variant !== undefined && item.variants.includes(variant) ? variant : undefined
    const model: SessionInfo["model"] = {
      provider: item.provider,
      id: item.id,
      ...(selectedVariant ? { variant: selectedVariant } : {}),
    }
    void source.selection.model(model)
  }
  const agentBusy = source.selection.busy("agent")
  const modelPending = source.selection.busy("model")
  return {
    agent: {
      options: () => agents().map(({ key, label }) => ({ key, label })),
      current: () => agents().find((item) => item.value === detail()?.agent)?.key,
      pending: () => source.data.agents() === undefined || agentBusy(),
      select: (key) => {
        const selected = agents().find((item) => item.key === key)
        if (selected) void source.selection.agent(selected.value)
      },
    },
    model: {
      options: () => models().map(({ value }) => visibility.option(value)),
      current: () => currentModel()?.key,
      pending: () => source.data.models() === undefined || modelPending(),
      select: (key) => {
        const selected = models().find((item) => item.key === key)
        if (selected) switchModel(selected.value)
      },
    },
    variant: {
      options: () => variants().map(({ key, label }) => ({ key, label })),
      current: () => variants().find((item) => item.value === (detail()?.model.variant ?? "default"))?.key,
      pending: () => source.data.models() === undefined || modelPending(),
      select: (key) => {
        const variant = variants().find((item) => item.key === key)?.value
        const item = currentModel()?.value
        if (variant === undefined || item === undefined) return
        if (variant === "default") {
          void source.selection.model({ provider: item.provider, id: item.id })
          return
        }
        switchModel(item, variant)
      },
    },
    error: source.selection.error,
  }
}

export type Controller = ReturnType<typeof createController>
