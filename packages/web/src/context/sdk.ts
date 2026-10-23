import { ByMorning, type ByMorningClient } from "@bymorning/client"

import { createSimpleContext } from "./helper"

/** Types for the application-lifetime generated browser client. */
export namespace SDK {
  export interface Interface {
    readonly client: ByMorningClient
    readonly baseURL: string
    /**
     * Subscribe to any API answer of 401. The Login Session has expired, been
     * revoked, or was never valid; subscribers decide whether that matters.
     */
    readonly onUnauthorized: (listener: () => void) => () => void
  }
}

function createSDK(): SDK.Interface {
  const baseURL = new URL(
    "/",
    import.meta.env.PROD && import.meta.env.VITE_GATEWAY_URL ? import.meta.env.VITE_GATEWAY_URL : window.location.origin,
  ).href
  const unauthorizedListeners = new Set<() => void>()
  const client = ByMorning.make({
    baseUrl: baseURL,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, credentials: "include" })
      if (response.status === 401) {
        for (const listener of unauthorizedListeners) {
          try {
            listener()
          } catch {
            // A broken listener must not swallow the refusal the caller is about to receive.
          }
        }
      }
      return response
    },
  })

  return {
    client,
    baseURL,
    onUnauthorized: (listener) => {
      unauthorizedListeners.add(listener)
      return () => {
        unauthorizedListeners.delete(listener)
      }
    },
  }
}

/** Own and access the application-lifetime generated browser client. */
export const { provider: SDKProvider, use: useSDK } = createSimpleContext({ name: "SDK", init: createSDK })
