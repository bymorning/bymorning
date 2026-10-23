import type { ModelListOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import { Integration } from "@bymorning/schema/integration"
import { Workspace } from "@bymorning/schema/workspace"
import { WorkspaceAccess } from "@bymorning/schema/workspace-access"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "../src/main.css"
import "../src/shell/shell.css"

import { DataProvider } from "../src/context/data"
import { DialogProvider } from "../src/context/dialog"
import { IntegrationProvider } from "../src/context/integration"
import { SDKProvider } from "../src/context/sdk"
import { WorkspaceScope } from "../src/context/workspace"
import { ProviderCatalog } from "../src/integration/providers/view"
import { GatewayModelsPage } from "../src/gateway/models/view"
import { OverlayHost } from "../src/ui/components/overlay-host"

document.documentElement.dataset.theme = "bymorning"
document.documentElement.dataset.colorScheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Fixture",
  status: "active",
  role: "admin",
})
const models: ModelListOutput = Array.from({ length: 75 }, (_, index) => ({
  info: {
    id: `model-${index}-${"long-identity-".repeat(index % 4)}`,
    provider: index % 2 ? Provider.Anthropic : Provider.OpenAI,
    apiID: `model-${index}`,
    name: index === 0 ? "A model with an intentionally extremely long display name that must wrap" : `Model ${index}`,
    description: "",
    status: index % 13 === 0 ? "deprecated" as const : "active" as const,
    releaseDate: "2026-01-01",
    lastUpdated: "2026-01-01",
    openWeights: false,
    capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: ["text" as const], output: ["text" as const] },
    variants: [],
    limit: { context: 200_000, output: 16_384 },
    cost: { input: 0.0035, output: 1.25, cache: { read: 0.0002, write: 0.004 } },
  },
  enabled: index % 8 !== 0,
  isPreferredDefault: index === 1,
  isEffectiveDefault: index === 1,
}))

function Fixture() {
  const [tab, setTab] = createSignal<"models" | "providers">("models")
  return (
    <SDKProvider><DialogProvider><OverlayHost><WorkspaceScope list={[workspace]} current={workspace}>
      <DataProvider><IntegrationProvider>
        <div data-component="shell" data-layout="document"><div data-slot="shell-body"><main data-slot="shell-content">
          <div data-slot="shell-route-content">
            <GatewayModelsPage
              items={() => models}
              state={() => ({ state: "ready" })}
              onRetry={async () => undefined}
              onToggle={async () => undefined}
              providerEntries={() => []}
              tab={tab}
              onTabChange={setTab}
              providers={<ProviderCatalog />}
            />
          </div>
        </main></div></div>
      </IntegrationProvider></DataProvider>
    </WorkspaceScope></OverlayHost></DialogProvider></SDKProvider>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
