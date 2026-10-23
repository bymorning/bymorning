import fuzzysort from "fuzzysort"
import { createEffect, createMemo, createUniqueId, For, onCleanup, Show, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { FileIcon } from "../../../../ui/components/file-icon"
import { Icon } from "../../../../ui/components/icon"
import { useI18n } from "../../../../ui/context/i18n"
import { ProjectFileReference } from "../project-file-reference"
import { closesCommands, commandDirection } from "./command-interaction"
import {
  ComposerCompletionGroup,
  ComposerCompletionPopover,
  ComposerCompletionRow,
  ComposerCompletionState,
} from "./completion"
import { useComposer } from "./context"
import { referenceMention } from "./interaction"
import type { ComposerSkill } from "./model"

type ReferenceCompletion =
  | { readonly type: "file"; readonly key: `file:${string}`; readonly path: string }
  | {
      readonly type: "skill"
      readonly key: `skill:${string}`
      readonly id: string
      readonly name: string
      readonly description: string
    }

export function ComposerAttachmentCommands(): JSX.Element {
  const composer = useComposer()
  const language = useI18n()
  const listboxID = createUniqueId()
  let resultsElement: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    query: "",
    start: 0,
    end: 0,
    status: "loading" as "loading" | "ready" | "error",
    files: [] as ReadonlyArray<string>,
    active: 0,
  })
  const skillResults = createMemo(() => {
    const skills = composer.skills() ?? []
    if (!state.query) return skills
    return fuzzysort.go(state.query, skills, { keys: ["id", "name"] }).map((result) => result.obj)
  })
  const results = createMemo<ReadonlyArray<ReferenceCompletion>>(() => {
    const skills = skillResults().map((skill: ComposerSkill) => ({
      type: "skill" as const,
      key: `skill:${skill.id}` as const,
      id: skill.id,
      name: skill.name,
      description: skill.description,
    }))
    return [
      ...skills,
      ...state.files.slice(0, 10).map((path) => ({
        type: "file" as const,
        key: `file:${path}` as const,
        path,
      })),
    ]
  })

  // Escape dismisses the menu for this mention only; the key-up that follows re-syncs the same text.
  let dismissed: { readonly start: number; readonly query: string } | undefined
  const close = () => setState({ open: false, query: "", start: 0, end: 0, status: "loading", files: [], active: 0 })
  const move = (delta: -1 | 1) => {
    if (results().length === 0) return
    setState("active", (state.active + delta + results().length) % results().length)
    requestAnimationFrame(() =>
      resultsElement?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" }),
    )
  }
  const select = (item: ReferenceCompletion | undefined) => {
    const editor = composer.editor()
    if (!item || !editor) return
    editor.replace(
      { start: state.start, end: state.end },
      `${item.type === "file" ? ProjectFileReference.format(item.path) : `@${item.id}`} `,
    )
    close()
  }
  onCleanup(
    composer.commands.register({
      open: () => state.open,
      controls: listboxID,
      activeDescendant: () => (results()[state.active] ? `${listboxID}-option-${state.active}` : undefined),
      matches: (editor) => referenceMention(editor.value, editor.selection.start, editor.selection.end) !== undefined,
      sync: (editor) => {
        const mention = referenceMention(editor.value, editor.selection.start, editor.selection.end)
        if (!mention) {
          dismissed = undefined
          return
        }
        if (dismissed?.start === mention.start && dismissed.query === mention.query) return
        dismissed = undefined
        if (state.open && state.query === mention.query && state.start === mention.start && state.end === mention.end)
          return
        setState({ open: true, ...mention, status: "loading", files: [], active: 0 })
      },
      keydown: (event) => {
        if (closesCommands(event)) {
          event.preventDefault()
          dismissed = { start: state.start, query: state.query }
          close()
          return true
        }
        const direction = commandDirection(event)
        if (direction !== undefined) {
          event.preventDefault()
          move(direction)
          return true
        }
        if ((event.key !== "Enter" && event.key !== "Tab") || results().length === 0) return false
        event.preventDefault()
        select(results()[state.active])
        return true
      },
      close,
      trigger: (trigger) => {
        if (trigger !== "@") return false
        dismissed = undefined
        const cursor = composer.cursor() ?? composer.value().length
        const mention = referenceMention(composer.value(), cursor, cursor)
        if (!mention) return false
        setState({ open: true, ...mention, status: "loading", files: [], active: 0 })
        return true
      },
    }),
  )
  createEffect(() => {
    if (!state.open) return
    const query = state.query
    const scope = composer.projectFiles.scope()
    if (scope === undefined) {
      setState({ status: "ready", files: [], active: 0 })
      return
    }
    const cached = untrack(composer.projectFiles.list)
    const files = query
      ? fuzzysort.go(query, cached, { limit: 10 }).map((result) => result.target)
      : cached.slice(0, 10)
    const abort = new AbortController()
    setState({ status: "loading", files, active: 0 })
    const timeout = setTimeout(() => {
      void composer.projectFiles.search(query, abort.signal).then(
        (paths) => {
          if (abort.signal.aborted) return
          setState({ status: "ready", files: paths.slice(0, 10), active: 0 })
        },
        () => {
          if (abort.signal.aborted) return
          setState({ status: "error", files, active: 0 })
        },
      )
    }, 100)
    onCleanup(() => {
      clearTimeout(timeout)
      abort.abort()
    })
  })
  return (
    <Show when={state.open}>
      <ComposerCompletionPopover
        ref={(element) => (resultsElement = element)}
        id={listboxID}
        kind="references"
        label={language.t("ui.session.composer.references")}
        busy={state.status === "loading"}
      >
        <Show when={state.status === "loading" && results().length === 0}>
          <ComposerCompletionState>{language.t("ui.session.composer.searchingReferences")}</ComposerCompletionState>
        </Show>
        <Show when={state.status === "error"}>
          <ComposerCompletionState>{language.t("ui.session.composer.referencesError")}</ComposerCompletionState>
        </Show>
        <Show when={state.status === "ready" && results().length === 0}>
          <ComposerCompletionState>{language.t("ui.session.composer.noReferences")}</ComposerCompletionState>
        </Show>
        <For each={results()}>
          {(item, index) => (
            <>
              <Show when={index() === 0 || results()[index() - 1]?.type !== item.type}>
                <ComposerCompletionGroup>
                  {language.t(item.type === "skill" ? "ui.session.composer.skills" : "ui.session.composer.files")}
                </ComposerCompletionGroup>
              </Show>
              <ComposerCompletionRow
                id={`${listboxID}-option-${index()}`}
                kind={item.type}
                active={state.active === index()}
                icon={
                  item.type === "file" ? <FileIcon node={{ path: item.path, type: "file" }} /> : <Icon name="skill" />
                }
                label={item.type === "file" ? item.path : item.name}
                description={item.type === "file" ? undefined : item.description}
                onActivate={() => setState("active", index())}
                onSelect={() => select(item)}
              />
            </>
          )}
        </For>
      </ComposerCompletionPopover>
    </Show>
  )
}
