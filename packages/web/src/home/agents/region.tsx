import type { AgentListOutput } from "@bymorning/client"

import { useData } from "../../context/data"
import { AgentList } from "../../features/agent-list/agent-list"
import { createListController } from "../../features/list-state"
import "./region.css"

type Agent = AgentListOutput[number]

export function HomeAgentsRegion(props: { readonly onOpen: (agent: Agent) => void }) {
  const data = useData()
  const agents = createListController({
    sourceState: data.workspace.agent.state,
    list: () => data.workspace.agent.list()?.map(({ permissions: _, ...agent }) => agent),
    sync: data.workspace.agent.sync,
  })

  return (
    <section data-component="home-agents" aria-label="Agents">
      <AgentList
        state={agents.state()}
        onOpen={(agentID) => {
          const agent = data.workspace.agent.list()?.find((item) => item.id === agentID)
          if (agent) props.onOpen(agent)
        }}
        onRetry={agents.retry}
      />
    </section>
  )
}
