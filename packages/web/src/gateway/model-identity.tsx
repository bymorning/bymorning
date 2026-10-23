import type { ProviderDirectoryEntry } from "@bymorning/client"
import { Show, type JSX } from "solid-js"

import { ProviderIcon } from "../integration/provider-icon"
import "./model-identity.css"

export function GatewayModelIdentity(props: {
  readonly provider: ProviderDirectoryEntry["info"]["name"]
  readonly name: string
  readonly id: string
  readonly showID?: boolean
  readonly children?: JSX.Element
}) {
  return (
    <div data-component="gateway-model-identity">
      <span data-slot="model-provider">
        <ProviderIcon provider={props.provider} />
      </span>
      <span data-slot="model-label">
        <strong>{props.name}</strong>
        <Show when={props.showID !== false}>
          <span>{props.id}</span>
        </Show>
      </span>
      {props.children}
    </div>
  )
}
