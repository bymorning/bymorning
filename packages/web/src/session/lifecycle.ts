import type { ByMorningClient, SessionUpdateInput } from "@bymorning/client"
import type { Data, SessionID } from "@bymorning/client/solid"
import { createMutation, useMutationState } from "@tanstack/solid-query"

/** One scoped native mutation ledger shared by header and inventory actions. */
export function createLifecycle(input: {
  readonly client: ByMorningClient
  readonly shared: Data
  readonly key: readonly unknown[]
  readonly refresh?: () => Promise<unknown>
}) {
  const mutationKey = [...input.key, "session", "update"]
  const mutation = createMutation(() => ({
    mutationKey,
    retry: false,
    mutationFn: (patch: SessionUpdateInput) => input.client.session.update(patch),
    onSuccess: async (updated) => {
      input.shared.session.invalidate()
      input.shared.session.detail.invalidate(updated.id)
      await Promise.all([
        input.shared.session.sync(),
        ...(input.shared.session.get(updated.id) ? [input.shared.session.detail.sync(updated.id)] : []),
      ])
      await input.refresh?.()
    },
  }))
  const ledger = useMutationState(() => ({
    filters: { mutationKey, exact: true },
    select: (entry) => ({
      sessionID: (entry.state.variables as SessionUpdateInput | undefined)?.sessionID,
      status: entry.state.status,
      error: entry.state.error,
    }),
  }))
  return {
    update: mutation.mutateAsync,
    pending: (id: SessionID) => ledger().some((entry) => entry.sessionID === id && entry.status === "pending"),
    error: (id: SessionID): unknown => {
      const latest = ledger().findLast((entry) => entry.sessionID === id)
      return latest?.status === "error" ? latest.error : undefined
    },
  }
}
