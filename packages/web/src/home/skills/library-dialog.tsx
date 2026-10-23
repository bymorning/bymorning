import type * as Workspace from "@bymorning/schema/workspace"
import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { useData } from "../../context/data"
import type { useDialog } from "../../context/dialog"
import type { useSDK } from "../../context/sdk"
import { skillLibrary } from "./library/catalog"
import { skillLibraryCategories, type SkillLibraryEntry } from "./library/model"
import { Button } from "../../ui/components/button"
import { Dialog as UIDialog, DialogBody, DialogHeader, DialogTitleGroup } from "../../ui/components/dialog"
import { Icon } from "../../ui/components/icon"
import "./library-dialog.css"

export interface SkillLibraryDialogProps {
  /** Skill names already in the Workspace, used to mark entries as added. */
  readonly existing: () => ReadonlySet<string>
  readonly add: (entry: SkillLibraryEntry) => Promise<unknown>
  readonly onAdded?: (entry: SkillLibraryEntry) => void
}

type EntryState = "idle" | "adding" | "added" | "error"

/** Catalog entries grouped by category; fixed for the module's lifetime. */
const grouped = skillLibraryCategories
  .map((category) => ({ category, entries: skillLibrary.filter((entry) => entry.category === category.id) }))
  .filter((group) => group.entries.length > 0)

/**
 * Browse suggested Skills and add them to the Workspace. An added entry becomes
 * an ordinary Workspace Skill the Workspace owns and can edit.
 */
export function SkillLibraryDialog(props: SkillLibraryDialogProps): JSX.Element {
  const [state, setState] = createStore<Record<string, EntryState>>({})
  const added = (entry: SkillLibraryEntry) => state[entry.id] === "added" || props.existing().has(entry.name)

  const add = (entry: SkillLibraryEntry) => {
    setState(entry.id, "adding")
    props.add(entry).then(
      () => {
        setState(entry.id, "added")
        props.onAdded?.(entry)
      },
      () => setState(entry.id, "error"),
    )
  }

  return (
    <UIDialog variant="card" size="full" data-component="skill-library-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title="Skill library"
          description="Add a suggested skill to this workspace. Everyone here can use it, and you can edit or delete it afterwards like any other skill."
        />
      </DialogHeader>
      <DialogBody>
        <div data-slot="skill-library-groups">
          <For each={grouped}>
            {(group) => (
              <section data-slot="skill-library-group" aria-labelledby={`skill-library-${group.category.id}`}>
                <header>
                  <h3 id={`skill-library-${group.category.id}`}>{group.category.label}</h3>
                  <p>{group.category.description}</p>
                </header>
                <ul data-slot="skill-library-items">
                  <For each={group.entries}>
                    {(entry) => (
                      <li data-slot="skill-library-item" data-state={added(entry) ? "added" : state[entry.id]}>
                        <div data-slot="skill-library-copy">
                          <strong>{entry.name}</strong>
                          <p>{entry.description}</p>
                          <Show when={state[entry.id] === "error"}>
                            <p data-slot="skill-library-error" role="alert">
                              Could not add this skill. Try again.
                            </p>
                          </Show>
                        </div>
                        <div data-slot="skill-library-action">
                          <Show
                            when={!added(entry)}
                            fallback={
                              <span data-slot="skill-library-added" role="status">
                                <Icon name="check" size="small" aria-hidden="true" />
                                Added
                              </span>
                            }
                          >
                            <Button
                              type="button"
                              variant="outline"
                              size="small"
                              disabled={state[entry.id] === "adding"}
                              data-action="skill-library-add"
                              aria-label={`${state[entry.id] === "adding" ? "Adding" : "Add"} ${entry.name}`}
                              onClick={() => add(entry)}
                            >
                              {state[entry.id] === "adding" ? "Adding…" : "Add"}
                            </Button>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </DialogBody>
    </UIDialog>
  )
}

/**
 * Opens the Skill library against the current Workspace's Skill catalog. Shared
 * by every entry point so `existing` and `add` are wired identically everywhere.
 */
export function openSkillLibrary(input: {
  readonly dialog: ReturnType<typeof useDialog>
  readonly sdk: ReturnType<typeof useSDK>
  readonly data: ReturnType<typeof useData>
  readonly workspaceID: Workspace.ID
  readonly onAdded?: (entry: SkillLibraryEntry) => void
}): void {
  input.dialog.show(() => (
    <SkillLibraryDialog
      existing={() => new Set(input.data.workspace.skill.list()?.map((skill) => skill.name) ?? [])}
      add={(entry) =>
        input.sdk.client.skill.create({
          workspace: input.workspaceID,
          name: entry.name,
          description: entry.description,
          instructions: entry.instructions,
        })
      }
      {...(input.onAdded ? { onAdded: input.onAdded } : {})}
    />
  ))
}
