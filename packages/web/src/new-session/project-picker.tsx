import type { JSX } from "solid-js"

import { useProject } from "../project/model"
import { Icon } from "../ui/components/icon"
import { MaterialPicker } from "../ui/components/material-picker"
import { ProjectAvatar } from "../ui/components/project-avatar"
import type { NewSessionDraftController } from "./controller"
import "./project-picker.css"

export function NewSessionProjectPicker(props: { readonly controller: NewSessionDraftController }): JSX.Element {
  const projects = useProject()
  const current = () => props.controller.project.list().find((project) => project.id === props.controller.project.current()?.projectID)
  const name = () => current()?.name ?? "Untitled"
  const avatar = () => current()?.icon?.override?.href ?? current()?.icon?.url?.href

  return (
    <div data-component="new-session-project-picker">
      <MaterialPicker
        items={props.controller.project.list()}
        key={(project) => project.id}
        label={(project) => project.name ?? "Untitled"}
        selected={current()?.id}
        searchLabel="Search projects"
        emptyLabel="No projects found"
        triggerLabel="Project"
        triggerTitle={`Current project: ${name()}`}
        disabled={!props.controller.project.confirmed()}
        appearance="base"
        class="new-session-project-picker-popover"
        trigger={
          <span data-slot="new-session-project-picker-trigger">
            <span data-slot="new-session-project-picker-avatar">
              <ProjectAvatar fallback={name()} src={avatar()} aria-hidden="true" />
            </span>
            <span data-slot="new-session-project-picker-label">{name()}</span>
            <Icon name="chevron-down" size="small" />
          </span>
        }
        leading={(project) => (
          <span data-slot="new-session-project-picker-avatar">
            <ProjectAvatar
              fallback={project.name ?? "Untitled"}
              src={project.icon?.override?.href ?? project.icon?.url?.href}
              aria-hidden="true"
            />
          </span>
        )}
        onSelect={(project) => props.controller.project.select(project.id)}
        footer={{ label: "Create Project", icon: <Icon name="central-plus-small" />, onSelect: projects.project.create }}
      />
    </div>
  )
}
