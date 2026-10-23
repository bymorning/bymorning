import type { ID as ProjectID } from "@bymorning/schema/project"
import { ProjectID as ProjectIDSchema } from "@bymorning/schema/project-id"
import { SessionID as SessionIDSchema } from "@bymorning/schema/identifier"
import type { SessionID } from "@bymorning/client/solid"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { useServer } from "@/runtime/server/runtime.js"

export function useSessions() {
  const server = useServer()
  const initial = new URLSearchParams(location.search)
  const [state, setState] = createStore({
    project: parseProject(initial.get("project")),
    session: parseSession(initial.get("session")),
    createName: "",
  })

  createEffect(() => {
    void server.select(state.session).catch(console.error)
  })

  const createProject = useMutation(() => ({
    mutationFn: (name: string) => server.data.project.create({ workspace: server.workspace, name }),
    onSuccess: (project) => {
      setState({ project: project.id, createName: "" })
      writeProject(project.id, "replace")
    },
  }))
  const createSession = useMutation(() => ({
    mutationFn: (projectID: ProjectID) => server.data.session.create({ workspace: server.workspace, projectID }),
    onSuccess: (session) => select(session.id),
  }))

  const select = (session?: SessionID) => {
    setState("session", session)
    const url = new URL(location.href)
    if (session) url.searchParams.set("session", session)
    else url.searchParams.delete("session")
    history.pushState({}, "", url)
  }
  const selectProject = (project: ProjectID) => {
    setState("project", project)
    writeProject(project, "replace")
  }
  const create = () => {
    const project = state.project ?? server.data.project.list()[0]?.id
    if (project) createSession.mutate(project)
  }
  const addProject = () => {
    const name = state.createName.trim()
    if (name) createProject.mutate(name)
  }
  const pop = () => {
    const params = new URLSearchParams(location.search)
    setState({ project: parseProject(params.get("project")), session: parseSession(params.get("session")) })
  }
  addEventListener("popstate", pop)
  onCleanup(() => removeEventListener("popstate", pop))

  return { state, setState, select, selectProject, create, addProject, createProject, createSession }
}

function parseSession(value: string | null): SessionID | undefined {
  return value && Schema.is(SessionIDSchema)(value) ? (value as SessionID) : undefined
}
function parseProject(value: string | null): ProjectID | undefined {
  return value && Schema.is(ProjectIDSchema)(value) ? value : undefined
}
function writeProject(project: ProjectID, mode: "push" | "replace") {
  const url = new URL(location.href)
  url.searchParams.set("project", project)
  if (mode === "push") history.pushState({}, "", url)
  else history.replaceState({}, "", url)
}
