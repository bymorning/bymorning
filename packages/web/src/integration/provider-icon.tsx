import type { ProviderDirectoryEntry } from "@bymorning/client"
import { createSignal, Show, type JSX } from "solid-js"

import { Icon } from "../ui/components/icon"
import { getProviderIconAsset } from "./provider-icon-registry"
import "./provider-icon.css"
import "./provider-icons.generated.css"

export function ProviderIcon(props: { readonly provider: ProviderDirectoryEntry["info"]["name"] }): JSX.Element {
  const asset = () => getProviderIconAsset(props.provider)
  const [imageFailed, setImageFailed] = createSignal(false)
  return (
    <span
      data-slot="provider-icon"
      data-provider-icon-kind={asset() && !imageFailed() ? "canonical" : "generic"}
      data-provider-icon={asset()?.sourceProvider}
      aria-hidden="true"
    >
      <Show when={asset()} fallback={<Icon name="central-plug" />}>
        {(icon) => (
          <>
            <img
              data-slot="provider-icon-source"
              src={icon().url}
              alt=""
              onLoad={() => setImageFailed(false)}
              onError={() => setImageFailed(true)}
            />
            <Show when={!imageFailed()} fallback={<Icon name="central-plug" />}>
              <span data-slot="provider-icon-mark" />
            </Show>
          </>
        )}
      </Show>
    </span>
  )
}
