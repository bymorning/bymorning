import type { IntegrationInfo } from "@bymorning/client"
import type { JSX } from "solid-js"

import { createIntegrationDialogController, type ChangeReason } from "./controller"
import { IntegrationDialogView } from "./view"

/** Render the accessible Integration picker and interactive connection workflows. */
export function IntegrationDialog(props: {
  readonly initialIntegration?: IntegrationInfo
  readonly providerOnly?: boolean
  readonly initialManagement?: boolean
  readonly onEnable?: (() => void | Promise<unknown>) | undefined
  readonly enablePending?: boolean | undefined
  readonly onChange?: (reason: ChangeReason) => void | Promise<unknown>
}): JSX.Element {
  const controller = createIntegrationDialogController(
    props.initialIntegration,
    props.providerOnly,
    props.initialManagement,
    props.onChange,
  )
  return (
    <IntegrationDialogView
      controller={controller}
      {...(props.onEnable === undefined ? {} : { onEnable: props.onEnable })}
      {...(props.enablePending === undefined ? {} : { enablePending: props.enablePending })}
    />
  )
}
