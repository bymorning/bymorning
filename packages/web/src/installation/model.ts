import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

import { createSimpleContext } from "../context/helper"
import { useSDK } from "../context/sdk"

/** Installation Admin grant state for the authenticated Account. */
export namespace Installation {
  export interface Interface {
    /** Whether the current Account holds an Installation Admin grant. */
    readonly admin: () => boolean
    /** Whether the grant state is still being resolved. */
    readonly loading: () => boolean
    /** Re-read the grant state, for example after a grant or revoke. */
    readonly refetch: () => Promise<void>
  }
}

function createInstallation(): Installation.Interface {
  const sdk = useSDK()
  const [state, setState] = createStore({ phase: "loading" as "loading" | "ready", admin: false })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const refetch = async () => {
    try {
      // `installation.self` answers without requiring a grant; a transport or
      // authentication failure reads as "not an admin" so gated surfaces hide.
      const self = await sdk.client.installation.self()
      if (!disposed) setState({ phase: "ready", admin: self.admin })
    } catch {
      if (!disposed) setState({ phase: "ready", admin: false })
    }
  }
  onMount(() => void refetch())
  return {
    admin: () => state.admin,
    loading: () => state.phase === "loading",
    refetch,
  }
}

/** Own and access the current Account's Installation Admin grant state. */
export const { provider: InstallationProvider, use: useInstallation } = createSimpleContext({
  name: "Installation",
  init: createInstallation,
})
