import type { ProviderDirectoryEntry } from "@bymorning/client"
import { createComponent } from "solid-js"
import { useMutation } from "@tanstack/solid-query"

import { useData } from "../../context/data"
import { useDialog } from "../../context/dialog"
import type { ChangeReason } from "../dialog/controller"
import { IntegrationDialog } from "../dialog/dialog"
import { ProviderUnavailable } from "./browser"
import type { ProviderCatalog } from "./model"
import { useScope } from "../../runtime/server/runtime"
import { showToast } from "../../ui/components/toast"
import { errorMessage } from "../../utils/error-message"

/**
 * Open the provider-only connection editor for a directory entry. Every change
 * refreshes the local provider directory. Connect, disconnect, and OAuth/AWS/
 * command completion alter the available model set, so Data-owned models
 * refresh too; a rename only moves the directory and skips the model sync.
 */
export function useProviderManagement(catalog: ProviderCatalog) {
  const dialog = useDialog()
  const data = useData()
  const activation = useProviderActivation(catalog)
  const refresh = (reason: ChangeReason) => {
    catalog.invalidate()
    // Rename does not change the available model set, so only the directory
    // sync runs; sync dedupes behind an in-flight read.
    if (reason === "rename") return catalog.sync().then(() => undefined)
    data.workspace.model.invalidate()
    return Promise.all([catalog.sync(), data.workspace.model.sync()]).then(() => undefined)
  }

  const connect = (entry: ProviderDirectoryEntry, initialManagement = true) => {
    const integration = entry.integration
    if (!integration) return
    return dialog.show(() =>
      createComponent(IntegrationDialog, {
        initialIntegration: integration,
        initialManagement,
        providerOnly: true,
        get onEnable() {
          const current = catalog.directory().find((candidate) => candidate.info.name === entry.info.name) ?? entry
          return current.info.name === "amazon-bedrock" && !current.active
            ? () =>
                activation.update(current.info.name, "enabled").catch((cause) =>
                  showToast({
                    variant: "error",
                    title: errorMessage(cause, "Could not enable deployment AWS credentials."),
                  }),
                )
            : undefined
        },
        get enablePending() {
          return activation.pending(entry.info.name)
        },
        onChange: refresh,
      }),
    )
  }
  return (entry: ProviderDirectoryEntry, initialManagement = true) =>
    !entry.integration
      ? dialog.show(() =>
          createComponent(ProviderUnavailable, {
            get entry() {
              return catalog.directory().find((candidate) => candidate.info.name === entry.info.name) ?? entry
            },
          }),
        )
      : connect(entry, initialManagement)
}

export function useProviderActivation(catalog: ProviderCatalog) {
  const scope = useScope()
  const data = useData()
  type Input = {
    readonly intent: number
    readonly provider: ProviderDirectoryEntry["info"]["name"]
    readonly name: string
    readonly status: "auto" | "enabled" | "disabled"
  }
  let nextIntent = 0
  const latestIntent = new Map<Input["provider"], number>()
  const mutationKey = ["workspace", scope.workspace, "provider", "activation"]
  const mutation = useMutation(() => ({
    mutationKey,
    retry: false,
    networkMode: "always",
    // Matching scopes serialize rapid changes while each admitted mutation keeps
    // its own variables in the native mutation ledger.
    scope: { id: JSON.stringify(mutationKey) },
    mutationFn: async (input: Input) => {
      try {
        await scope.api.provider.update({ workspace: scope.workspace, provider: input.provider, status: input.status })
        catalog.invalidate()
        data.workspace.model.invalidate()
        await Promise.all([catalog.sync(), data.workspace.model.sync()])
      } catch (cause) {
        // An uncertain write is reconciled by reads; never replay the mutation.
        catalog.invalidate()
        data.workspace.model.invalidate()
        await Promise.all([catalog.sync(), data.workspace.model.sync()]).catch(() => undefined)
        throw cause
      }
    },
    onSuccess: (_, input) => {
      if (input.intent !== latestIntent.get(input.provider) || input.status === "auto") return
      showToast({
        variant: "success",
        title: `${input.name} provider ${input.status}`,
      })
    },
  }))
  return {
    active: (provider: Input["provider"], authoritative: boolean) =>
      mutation.isPending && mutation.variables?.provider === provider
        ? mutation.variables.status !== "disabled"
        : authoritative,
    pending: (provider: string) => mutation.isPending && mutation.variables?.provider === provider,
    update: (provider: Input["provider"], status: Input["status"]) => {
      const entry = catalog.directory().find((candidate) => candidate.info.name === provider)
      const name = entry?.info.displayName ?? entry?.integration?.name ?? provider
      const intent = ++nextIntent
      latestIntent.set(provider, intent)
      return mutation.mutateAsync({ intent, provider, name, status })
    },
  }
}
