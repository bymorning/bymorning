import { useSearchParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { For, Show, type JSX } from "solid-js"

import { PermissionView } from "../../features/session/ui/permission-view"
import { ContextToolGroup, FileToolGroup } from "../../features/session/ui/tool-group"
import { ToolDisplay } from "../../features/session/ui/tools/tool-display"
import { Button } from "../../ui/components/button"
import { Select } from "../../ui/components/select"
import { useTheme, type ColorScheme } from "../../ui/theme"
import { prototypeFamilies, prototypeScenarios, toolStates, type PrototypeScenario, type PrototypeToolState } from "./fixtures"
import { SuggestedToolDisplay } from "./suggested-tool-display"
import "./route.css"

type FilterState = PrototypeToolState | "all"

export function ToolUIPrototypeRoute(): JSX.Element {
  const theme = useTheme()
  const [params, setParams] = useSearchParams()
  const familyParam = Array.isArray(params.family) ? params.family[0] : params.family
  const stateParam = Array.isArray(params.state) ? params.state[0] : params.state
  const initialFamily = prototypeFamilies.includes(familyParam ?? "") ? familyParam! : "All"
  const initialState = stateParam === "all" || toolStates.includes(stateParam as PrototypeToolState) ? stateParam as FilterState : "all"
  const [controls, setControls] = createStore({ family: initialFamily, state: initialState, open: params.open === "1" })
  const scenarios = () => prototypeScenarios.filter((scenario) =>
    (controls.family === "All" || scenario.family === controls.family) &&
    (controls.state === "all" || scenarioState(scenario) === controls.state),
  )
  const update = (key: "family" | "state", value: string) => {
    setControls(key, value)
    setParams({ [key]: value === "All" || value === "all" ? undefined : value })
  }
  const setOpen = (open: boolean) => {
    setControls("open", open)
    setParams({ open: open ? "1" : undefined })
  }
  return (
    <main data-component="tool-ui-prototype">
      <div data-slot="prototype-page">
        <header data-slot="prototype-toolbar">
          <h1>Tool UI prototype</h1>
          <section data-slot="prototype-controls" aria-label="Prototype controls">
            <label>Family
              <Select
                aria-label="Tool / family filter"
                options={[...prototypeFamilies]}
                current={controls.family}
                onSelect={(family) => family && update("family", family)}
              />
            </label>
            <label>State
              <Select
                aria-label="State filter"
                options={["all", ...toolStates] satisfies FilterState[]}
                current={controls.state}
                label={(state) => (state === "all" ? "All states" : state)}
                onSelect={(state) => state && update("state", state)}
              />
            </label>
            <fieldset>
              <legend>Disclosure</legend>
              <Button type="button" size="small" variant="ghost-muted" aria-pressed={!controls.open} data-expanded={!controls.open ? "" : undefined} onClick={() => setOpen(false)}>Collapsed</Button>
              <Button type="button" size="small" variant="ghost-muted" aria-pressed={controls.open} data-expanded={controls.open ? "" : undefined} onClick={() => setOpen(true)}>Expanded</Button>
            </fieldset>
            <fieldset>
              <legend>Theme</legend>
              <For each={["system", "light", "dark"] as const}>{(scheme) => (
                <Button type="button" size="small" variant="ghost-muted" aria-pressed={theme.scheme() === scheme} data-expanded={theme.scheme() === scheme ? "" : undefined} onClick={() => theme.setColorScheme(scheme)}>{title(scheme)}</Button>
              )}</For>
            </fieldset>
          </section>
        </header>

        <p data-slot="result-count" role="status">Showing {scenarios().length} of {prototypeScenarios.length} scenarios</p>
        <div data-slot="comparison-header" aria-hidden="true">
          <span>Variation</span><span>Current</span><span>Suggested</span>
        </div>
        <section data-slot="scenario-list" aria-label="Tool UI comparisons">
          <For each={scenarios()}>{(scenario) => (
            <article data-component="prototype-scenario" data-family={scenario.family} data-state={scenarioState(scenario)} title={scenario.note}>
              <header>
                <h2>{scenario.title}</h2>
                <span data-slot="state-label">{scenarioState(scenario)}</span>
              </header>
              <div data-slot="comparison-grid">
                <section data-slot="comparison-cell" aria-label={`${scenario.title}, Current implementation`}>
                  <h3>Current implementation</h3>
                  <div data-slot="renderer-stage"><CurrentScenario scenario={scenario} open={controls.open} onOpenChange={setOpen} /></div>
                </section>
                <section data-slot="comparison-cell" aria-label={`${scenario.title}, Suggested design`}>
                  <h3>Suggested design</h3>
                  <div data-slot="renderer-stage"><SuggestedToolDisplay scenario={scenario} open={controls.open} onOpenChange={setOpen} /></div>
                </section>
              </div>
            </article>
          )}</For>
          <Show when={scenarios().length === 0}><p data-slot="empty-filter">No scenario matches both filters.</p></Show>
        </section>
      </div>
    </main>
  )
}

function CurrentScenario(props: { readonly scenario: PrototypeScenario; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const scenario = () => props.scenario
  return (
    <Show when={scenario().kind !== "hidden"} fallback={<ProjectionHidden name={(scenario() as Extract<PrototypeScenario, { kind: "hidden" }>).toolName} />}>
      <Show when={scenario().kind !== "permission"} fallback={
        <PermissionView
          item={(scenario() as Extract<PrototypeScenario, { kind: "permission" }>).item}
          pending={(scenario() as Extract<PrototypeScenario, { kind: "permission" }>).pending}
          error={(scenario() as Extract<PrototypeScenario, { kind: "permission" }>).error}
          onReply={() => undefined}
        />
      }>
        <Show when={scenario().kind !== "context-group"} fallback={
          <ContextToolGroup entries={(scenario() as Extract<PrototypeScenario, { kind: "context-group" }>).entries} open={props.open} onOpenChange={props.onOpenChange} />
        }>
          <Show when={scenario().kind !== "file-group"} fallback={
            <FileToolGroup
              entries={(scenario() as Extract<PrototypeScenario, { kind: "file-group" }>).entries}
              fileOpen={() => props.open}
              onFileOpenChange={(_path, open) => props.onOpenChange(open)}
            />
          }>
            <ToolDisplay
              tool={(scenario() as Extract<PrototypeScenario, { kind: "tool" }>).tool}
              onFileOpen={() => undefined}
              agents={[{ id: "explore", name: "Explorer" }]}
              actions={{ sessionHref: (id) => `#prototype-session-${id}`, openSession: () => undefined, sessionStatus: () => "running" }}
              open={props.open}
              onOpenChange={props.onOpenChange}
            />
          </Show>
        </Show>
      </Show>
    </Show>
  )
}

function ProjectionHidden(props: { readonly name: string }) {
  return <div data-component="projection-hidden"><strong>No current card</strong><p><code>{props.name}</code> is removed before timeline rendering.</p></div>
}

function scenarioState(scenario: PrototypeScenario): PrototypeToolState {
  return scenario.kind === "tool" ? scenario.tool.state.type : scenario.state
}

function title(scheme: ColorScheme) {
  return scheme[0]!.toUpperCase() + scheme.slice(1)
}
