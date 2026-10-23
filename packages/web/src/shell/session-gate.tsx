import { Show, createEffect, createSignal, onCleanup, onMount, type JSX, type ParentProps } from "solid-js"

import { useSDK } from "../context/sdk"
import { createSimpleContext } from "../context/helper"
import { useOptionalDialog } from "../context/dialog"
import { Button } from "../ui/components/button"
import { Icon } from "../ui/components/icon"
import { Wordmark } from "../ui/components/wordmark"
import "./session-gate.css"

/** Why authenticated content was taken down: client-observed inactivity or a server refusal. */
export type Ended = "locked" | "expired"

export interface SessionGate {
  /** Set once the display is locked or the session has ended. */
  readonly ended: () => Ended | undefined
  /** True once an authenticated Workspace is on screen; 401s end the session only while armed. */
  readonly armed: () => boolean
  /** Mark authenticated content as visible; starts the inactivity timer. */
  readonly arm: () => void
}

/** The fallback matches the Auth host default (SESSION_IDLE_TIMEOUT, 15 minutes). */
const fallbackIdleMillis = 15 * 60 * 1000
/** Deliberate user interaction events; timer resets are throttled to one per second. */
const activityEvents = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const

const {
  provider: SessionGateProviderBase,
  use: useSessionGateBase,
  optional: useSessionGateOptional,
} = createSimpleContext({
  name: "SessionGate",
  init: (): SessionGate => {
    const sdk = useSDK()
    const dialog = useOptionalDialog()
    const [ended, setEnded] = createSignal<Ended>()
    let armed = false
    let idleMillis = fallbackIdleMillis
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastReset = 0

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const end = (reason: Ended) => {
      if (ended() !== undefined) return
      clear()
      // An open modal would aria-hide this takeover; close dialogs first.
      dialog?.closeAll()
      setEnded(reason)
    }
    const lock = () => {
      const wasActive = ended() === undefined
      end("locked")
      // The server already refuses the idle session; end its record promptly.
      if (wasActive) void sdk.client.auth.logout().catch(() => undefined)
    }
    const schedule = (baseline: number) => {
      clear()
      if (!armed || ended() !== undefined) return
      const remaining = idleMillis - (Date.now() - baseline)
      timer = setTimeout(lock, Math.max(remaining, 0))
    }
    const activity = () => {
      const now = Date.now()
      if (now - lastReset < 1_000) return
      lastReset = now
      schedule(now)
    }

    onMount(() => {
      for (const event of activityEvents) {
        window.addEventListener(event, activity, { passive: true })
      }
      onCleanup(() => {
        clear()
        for (const event of activityEvents) window.removeEventListener(event, activity)
      })
      // The installation's configured idle limit replaces the fallback.
      void sdk.client.auth
        .method()
        .then((method) => {
          const reported = method.idleTimeout
          if (typeof reported !== "number" || !Number.isFinite(reported) || reported <= 0) return
          idleMillis = reported
          lastReset = Date.now()
          schedule(lastReset)
        })
        .catch(() => undefined)
    })

    const off = sdk.onUnauthorized(() => {
      // A server refusal only ends the session here once the Workspace is on
      // screen; cold unauthenticated loads keep their plain redirect to login.
      if (!armed) return
      end("expired")
    })
    onCleanup(off)

    return {
      ended,
      armed: () => armed,
      arm: () => {
        if (armed) return
        armed = true
        lastReset = Date.now()
        schedule(lastReset)
      },
    }
  },
})

/** `use` throws outside the provider; `optional` serves isolated route tests. */
export const useSessionGate = Object.assign(useSessionGateBase, { optional: useSessionGateOptional })

/**
 * Full-screen session lock and expiry overlay. While it is up, the application
 * beneath is inert and fully covered (3.1.10 pattern-hiding display).
 */
function SessionEnded(props: { readonly reason: Ended }): JSX.Element {
  let action: HTMLAnchorElement | undefined
  onMount(() => action?.focus())
  return (
    <div
      data-component="session-gate"
      data-reason={props.reason}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-gate-title"
    >
      <section data-slot="session-gate-card">
        <div data-slot="session-gate-eyebrow">
          <Wordmark size={18} />
        </div>
        <div data-slot="session-gate-icon" aria-hidden="true">
          <Icon name="shield-key" />
        </div>
        <h1 id="session-gate-title" data-slot="session-gate-title">
          {props.reason === "locked" ? "Session locked" : "Session expired"}
        </h1>
        <p data-slot="session-gate-description">
          {props.reason === "locked"
            ? "This session was locked after a period of inactivity and what was on screen is now hidden. Sign in again to continue."
            : "Your session has expired or was signed out elsewhere. Sign in again to continue."}
        </p>
        <div data-slot="session-gate-actions">
          <Button as="a" variant="primary" size="large" href="/login" target="_self" ref={action}>
            Sign in again
          </Button>
        </div>
      </section>
    </div>
  )
}

/** Owns the inactivity lock and server-refusal screen for the authenticated route lifetime. */
export function SessionGate(props: ParentProps): JSX.Element {
  let root: HTMLDivElement | undefined
  const gate = useSessionGate()
  createEffect(() => {
    const ended = gate.ended()
    if (root !== undefined) root.inert = ended !== undefined
  })
  onCleanup(() => {
    if (root !== undefined) root.inert = false
  })
  return (
    <>
      <div
        ref={(element) => {
          root = element
        }}
        data-component="session-gate-content"
        style={{ display: "contents" }}
      >
        {props.children}
      </div>
      <Show when={gate.ended()}>{(reason) => <SessionEnded reason={reason()} />}</Show>
    </>
  )
}

export { SessionGateProviderBase as SessionGateProvider }
