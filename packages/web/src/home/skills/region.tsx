import type { SkillListOutput } from "@bymorning/client"

import { useData } from "../../context/data"
import { internalSkill } from "../../features/skill-list/skill-list-model"
import { SkillList } from "../../features/skill-list/skill-list"
import { createListController } from "../../features/list-state"
import "./region.css"

type Skill = SkillListOutput[number]

export function HomeSkillsRegion(props: { readonly onOpen: (skill: Skill) => void }) {
  const data = useData()
  const visible = () => data.workspace.skill.list()?.filter((skill) => !internalSkill(skill.id))
  const skills = createListController({
    sourceState: data.workspace.skill.state,
    list: () => visible()?.map(({ id, name, description }) => ({ id, name, description })),
    sync: data.workspace.skill.sync,
  })

  return (
    <section data-component="home-skills" aria-label="Skills">
      <SkillList
        state={skills.state()}
        onOpen={(skillID) => {
          const skill = visible()?.find((item) => item.id === skillID)
          if (skill) props.onOpen(skill)
        }}
        onRetry={skills.retry}
      />
    </section>
  )
}
