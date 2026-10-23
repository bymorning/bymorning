import { isUnauthorizedError } from "@bymorning/client"
import { useNavigate } from "@solidjs/router"
import { createEffect, createResource, onCleanup } from "solid-js"

import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

/** Load current-person display data for the authenticated route lifetime. */
export const {
  provider: AccountProvider,
  use: useAccount,
  optional: useOptionalAccount,
} = createSimpleContext({
  name: "Account",
  init: () => {
    const sdk = useSDK()
    const navigate = useNavigate()
    const request = new AbortController()
    onCleanup(() => request.abort())
    const [profile] = createResource(() => sdk.client.account.get({ signal: request.signal }))

    createEffect(() => {
      const error = profile.error
      if (isUnauthorizedError(error) || (error instanceof Error && isUnauthorizedError(error.cause))) {
        navigate("/login", { replace: true })
      }
    })

    return {
      // A display-data failure must not replace the workspace with a blank screen.
      current: () => (profile.error ? undefined : profile()),
    }
  },
})
