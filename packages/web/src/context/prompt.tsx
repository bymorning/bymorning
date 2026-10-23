import type { ParentProps } from "solid-js"

import { createSimpleContext } from "./helper"
import { type PromptScope, type PromptTarget } from "./prompt-state"
import { useWorkspaceRuntime } from "./workspace-runtime"

export type PromptProviderProps = ParentProps<{ readonly scope: PromptScope }>

function createPrompt(props: PromptProviderProps): PromptTarget {
  return useWorkspaceRuntime().prompt(props.scope)
}

export const { provider: PromptProvider, use: usePrompt } = createSimpleContext({
  name: "Prompt",
  gate: false,
  init: createPrompt,
})
