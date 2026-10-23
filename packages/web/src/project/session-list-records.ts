import type { SessionInfo } from "@bymorning/client"
import type { Project } from "@bymorning/schema/project"

import type { SessionListGroup, SessionListItem } from "../features/session-list/session-list-model"
import { sessionLabel } from "../utils/session-title"

export type SessionRecord = {
  readonly session: SessionInfo
  readonly project: Project.Info
  readonly projectName: string
}

export type SessionListLanguage = {
  readonly t: (key: string, options?: { readonly query?: string; readonly scope?: string }) => string
}

export function buildSessionRecords(input: {
  readonly sessions: () => ReadonlyArray<SessionInfo>
  readonly selected: () => Project.Info | undefined
  readonly projectByID: () => Map<Project.ID, Project.Info>
}) {
  const selected = input.selected()
  return [...new Map(input.sessions().map((session) => [session.id, session] as const)).values()]
    .filter((session) => selected === undefined || session.projectID === selected.id)
    .toSorted((left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf() || left.id.localeCompare(right.id))
    .flatMap((session) => {
      const project = input.projectByID().get(session.projectID)
      if (!project) return []
      return { session, project, projectName: project.name ?? "Untitled" }
    })
}

export function toSessionListItem(record: SessionRecord): SessionListItem {
  const avatar = record.project.icon?.override?.href ?? record.project.icon?.url?.href
  return {
    key: `${record.session.projectID}:${record.session.id}`,
    id: record.session.id,
    title: sessionLabel(record.session) || "Untitled",
    updatedAt: record.session.updatedAt,
    ...(record.session.scheduledTaskID === undefined ? {} : { scheduledTask: true }),
    project: {
      name: record.projectName,
      ...(avatar ? { avatar } : {}),
    },
  }
}

export function groupSessionItemsByProject(records: ReadonlyArray<SessionRecord>) {
  return new Map(
    [...Map.groupBy(records, (record) => record.session.projectID)].map(([projectID, items]) => [
      projectID,
      items.map(toSessionListItem),
    ]),
  )
}

export function groupSessions(records: ReadonlyArray<SessionRecord>, copy: SessionListLanguage): SessionListGroup[] {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  const todaySessions = records.filter((record) => sameDay(record.session.updatedAt, now))
  const yesterdaySessions = records.filter((record) => sameDay(record.session.updatedAt, yesterday))
  const olderSessions = records.filter(
    (record) => !sameDay(record.session.updatedAt, now) && !sameDay(record.session.updatedAt, yesterday),
  )
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? copy.t("sidebar.project.recentSessions")
      : copy.t("home.sessions.group.older")
  return [
    { id: "today", title: copy.t("home.sessions.group.today"), items: todaySessions.map(toSessionListItem) },
    {
      id: "yesterday",
      title: copy.t("home.sessions.group.yesterday"),
      items: yesterdaySessions.map(toSessionListItem),
    },
    { id: "older", title: olderTitle, items: olderSessions.map(toSessionListItem) },
  ].filter((group) => group.items.length > 0)
}
