import type { ProviderDirectoryEntry } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { render } from "@solidjs/testing-library"
import { createComponent, getOwner, runWithOwner } from "solid-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProviderCatalog } from "./model"
import { useProviderManagement } from "./management"

const mocks = vi.hoisted(() => ({
  // IntegrationDialog is mocked, so the entry only passes through untouched.
  props: [] as Array<{ readonly onChange?: (reason: "activate" | "connect" | "disconnect" | "rename") => unknown }>,
  data: undefined as { workspace: { model: { invalidate: () => void; sync: () => Promise<void> } } } | undefined,
}))

vi.mock("../../context/data", () => ({ useData: () => mocks.data }))
vi.mock("../../context/dialog", () => ({ useDialog: () => ({ show: (element: () => unknown) => element() }) }))
vi.mock("../../runtime/server/runtime", () => ({
  useScope: () => ({
    workspace: "wrk_test",
    api: { provider: { update: vi.fn().mockResolvedValue(undefined) } },
  }),
}))
vi.mock("../dialog/dialog", () => ({
  IntegrationDialog: (props: {
    readonly onChange?: (reason: "activate" | "connect" | "disconnect" | "rename") => unknown
  }) => {
    mocks.props.push(props)
    return null
  },
}))

const createCatalog = () => ({ invalidate: vi.fn(), sync: vi.fn().mockResolvedValue(undefined) })
const createModel = () => ({ invalidate: vi.fn(), sync: vi.fn().mockResolvedValue(undefined) })
const mountManagement = (catalog: ProviderCatalog) => {
  let manage!: ReturnType<typeof useProviderManagement>
  let owner!: NonNullable<ReturnType<typeof getOwner>>
  const query = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const Capture = () => {
    owner = getOwner()!
    manage = useProviderManagement(catalog)
    return null
  }
  render(() =>
    createComponent(QueryClientProvider, {
      client: query,
      get children() {
        return createComponent(Capture, {})
      },
    }),
  )
  return (...input: Parameters<typeof manage>) => runWithOwner(owner, () => manage(...input))
}
const entry: ProviderDirectoryEntry = {
  info: {
    name: Provider.OpenAI,
    displayName: "OpenAI",
    api: Provider.API.make("https://api.openai.com/v1"),
    format: "openai",
    status: "auto",
  },
  integration: {
    id: Integration.ID.make("openai"),
    name: "OpenAI",
    methods: [{ type: "key", label: "API key" }],
    connections: [],
  },
  active: true,
  connected: true,
  connectionCount: 1,
  modelCount: 1,
}

describe("useProviderManagement", () => {
  beforeEach(() => {
    mocks.props.length = 0
  })

  it("refreshes Data-owned models for connect and disconnect changes", async () => {
    const catalog = createCatalog()
    const model = createModel()
    mocks.data = { workspace: { model } }
    const manage = mountManagement(catalog as unknown as ProviderCatalog)
    manage(entry)

    for (const reason of ["connect", "disconnect"] as const) {
      const invalidateCount = catalog.invalidate.mock.calls.length
      const syncCount = catalog.sync.mock.calls.length
      await mocks.props[0]!.onChange!(reason)
      expect(catalog.invalidate).toHaveBeenCalledTimes(invalidateCount + 1)
      expect(catalog.sync).toHaveBeenCalledTimes(syncCount + 1)
      expect(model.invalidate).toHaveBeenCalledTimes(invalidateCount + 1)
      expect(model.sync).toHaveBeenCalledTimes(syncCount + 1)
    }
  })

  it("skips Data-owned models only for rename changes", async () => {
    const catalog = createCatalog()
    const model = createModel()
    mocks.data = { workspace: { model } }
    const manage = mountManagement(catalog as unknown as ProviderCatalog)
    manage(entry)

    await mocks.props[0]!.onChange!("rename")
    expect(catalog.invalidate).toHaveBeenCalledOnce()
    expect(catalog.sync).toHaveBeenCalledOnce()
    expect(model.invalidate).not.toHaveBeenCalled()
    expect(model.sync).not.toHaveBeenCalled()

    await mocks.props[0]!.onChange!("activate")
    expect(catalog.invalidate).toHaveBeenCalledTimes(2)
    expect(catalog.sync).toHaveBeenCalledTimes(2)
    expect(model.invalidate).toHaveBeenCalledOnce()
    expect(model.sync).toHaveBeenCalledOnce()
  })
})
