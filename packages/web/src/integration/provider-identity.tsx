import type { ProviderDirectoryEntry } from "@bymorning/client"

import { ProviderIcon } from "./provider-icon"

export function ProviderIdentity(props: { readonly entry: ProviderDirectoryEntry }) {
  return (
    <span data-slot="provider-identity">
      <ProviderIcon provider={props.entry.info.name} />
      <strong>{props.entry.info.displayName ?? props.entry.integration?.name ?? props.entry.info.name}</strong>
    </span>
  )
}
