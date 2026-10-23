/** Channel prefixes of the Kubernetes channel WebSocket protocols (v4 and v5 share them; v5 adds stdin close on 255). */
export const Channel = { stdin: 0, stdout: 1, stderr: 2, status: 3 } as const

/** Preferred first; the API server picks the first it supports (v5 is GA from Kubernetes 1.31). */
export const subprotocols = ["v5.channel.k8s.io", "v4.channel.k8s.io"] as const

export type Exit =
  { readonly type: "exit"; readonly code: number } | { readonly type: "failure"; readonly message: string }

/**
 * Interpret the metav1.Status on the error channel. `Success` is exit 0; `NonZeroExitCode` carries the code in an
 * `ExitCode` cause. Anything else (for example the process could not be started, or the container is gone) is a
 * failure of the exec itself, not a program exit.
 */
export const exit = (payload: string): Exit => {
  let status: unknown
  try {
    status = JSON.parse(payload)
  } catch {
    return { type: "failure", message: "Malformed exec status" }
  }
  if (typeof status !== "object" || status === null) return { type: "failure", message: "Malformed exec status" }
  const value = status as {
    status?: unknown
    reason?: unknown
    message?: unknown
    details?: { causes?: ReadonlyArray<{ reason?: unknown; message?: unknown }> }
  }
  if (value.status === "Success") return { type: "exit", code: 0 }
  if (value.reason === "NonZeroExitCode") {
    const cause = value.details?.causes?.find((entry) => entry.reason === "ExitCode")
    const code = typeof cause?.message === "string" ? Number(cause.message) : Number.NaN
    if (Number.isInteger(code)) return { type: "exit", code }
  }
  return { type: "failure", message: typeof value.message === "string" ? value.message : "Exec failed" }
}
