/** Declares durable Workspace Skill catalog invalidations. */
export * as SkillEvent from "./skill-event.js"

import { Event } from "./event.js"
import { Skill } from "./skill.js"
import { Workspace } from "./workspace.js"

export const Created = Event.define("skill.created", {
  workspaceID: Workspace.ID,
  skillID: Skill.ID,
})

export const Updated = Event.define("skill.updated", {
  workspaceID: Workspace.ID,
  skillID: Skill.ID,
})

export const Deleted = Event.define("skill.deleted", {
  workspaceID: Workspace.ID,
  skillID: Skill.ID,
})

export const Definitions = Event.inventory(Created, Updated, Deleted)
