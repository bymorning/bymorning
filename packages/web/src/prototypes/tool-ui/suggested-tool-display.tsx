import { For, Show, type JSX } from "solid-js"

import { Button } from "../../ui/components/button"
import { TextShimmer } from "../../ui/components/text-shimmer"
import type { PrototypeScenario, ToolScenario } from "./fixtures"
import { basename, permissionCopy, toolCopy } from "./suggested-language"

export function SuggestedToolDisplay(props: {
  readonly scenario: PrototypeScenario
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): JSX.Element {
  const file = () => succeededFile(props.scenario)
  const output = () => detail(props.scenario)
  const copy = () => toolCopy(props.scenario)

  return (
    <Show when={props.scenario.kind === "permission" ? props.scenario : undefined} fallback={
      <Show when={file()} fallback={
        <div data-component="suggested-tool" data-state={scenarioState(props.scenario)}>
          <Show when={output()} fallback={<Summary scenario={props.scenario} />}>
            {(content) => (
              <>
                <button
                  type="button"
                  data-slot="suggested-summary"
                  aria-label={`${copy().accessible}; ${props.open ? "Expanded" : "Collapsed"}`}
                  aria-expanded={props.open}
                  aria-controls={`suggested-detail-${props.scenario.id}`}
                  onClick={() => props.onOpenChange(!props.open)}
                >
                  <SummaryContent scenario={props.scenario} />
                </button>
                <div
                  id={`suggested-detail-${props.scenario.id}`}
                  data-slot="suggested-output"
                  role="region"
                  aria-label={`${copy().accessible} detail`}
                  hidden={!props.open}
                >
                  {content()}
                </div>
              </>
            )}
          </Show>
        </div>
      }>{(path) => (
        <div data-component="suggested-tool" data-state="succeeded">
          <button type="button" data-slot="suggested-file" title={path()} aria-label={`View file ${path()}`}>
            <bdi>{basename(path())}</bdi>
            <span>View file</span>
          </button>
        </div>
      )}</Show>
    }>{(scenario) => <SuggestedPermission scenario={scenario()} />}</Show>
  )
}

function Summary(props: { readonly scenario: PrototypeScenario }) {
  const copy = () => toolCopy(props.scenario)
  return (
    <div data-slot="suggested-summary" role="group" aria-label={copy().accessible}>
      <SummaryContent scenario={props.scenario} />
    </div>
  )
}

function SummaryContent(props: { readonly scenario: PrototypeScenario }) {
  const copy = () => toolCopy(props.scenario)
  const running = () => scenarioState(props.scenario) === "running"
  return (
    <span data-slot="suggested-phrase" aria-hidden="true">
      <span data-slot="suggested-verb" data-tone={copy().failed ? "danger" : undefined}>
        <SuggestedText text={copy().verb} running={running()} />
      </span>
      <Show when={copy().subject}>{(subject) => (
        <bdi data-slot="suggested-subject" data-mono={subject().mono ? "" : undefined} title={subject().title}>
          <SuggestedText text={subject().visible} running={running()} offset={1} />
        </bdi>
      )}</Show>
      <Show when={copy().kind}>{(kind) => (
        <span data-slot="suggested-kind"><SuggestedText text={kind()} running={running()} offset={2} /></span>
      )}</Show>
      <Show when={copy().secondary}>{(value) => (
        <span data-slot="suggested-secondary"><SuggestedText text={value()} running={running()} offset={3} /></span>
      )}</Show>
    </span>
  )
}

function SuggestedText(props: { readonly text: string; readonly running: boolean; readonly offset?: number }) {
  return (
    <Show when={props.running} fallback={props.text}>
      <TextShimmer text={props.text} offset={props.offset ?? 0} />
    </Show>
  )
}

function SuggestedPermission(props: { readonly scenario: Extract<PrototypeScenario, { kind: "permission" }> }) {
  const copy = () => permissionCopy(props.scenario)
  return (
    <section
      data-component="suggested-permission"
      aria-label={copy().accessible}
      aria-busy={props.scenario.pending}
    >
      <p aria-hidden="true">
        <span data-slot="suggested-permission-preamble">{copy().preamble}</span>
        {" "}
        <span data-slot="suggested-permission-action">{copy().action}</span>
        <For each={copy().resources}>{(resource, index) => (
          <>
            {index() === 0 ? " " : ", "}
            <bdi
              data-slot="suggested-permission-resource"
              data-mono={resource.mono ? "" : undefined}
              title={resource.title}
            >{resource.visible}</bdi>
          </>
        )}</For>
        ?
      </p>
      <Show when={props.scenario.error}>{(message) => <p data-slot="suggested-permission-error" role="alert">{message()}</p>}</Show>
      <div data-slot="suggested-permission-actions" role="group" aria-label="Permission response">
        <Button type="button" size="small" variant="danger" disabled={props.scenario.pending}>Reject</Button>
        <Button type="button" size="small" variant="primary" disabled={props.scenario.pending}>Once</Button>
      </div>
    </section>
  )
}

function succeededFile(scenario: PrototypeScenario) {
  if (scenario.kind !== "tool" || scenario.tool.state.type !== "succeeded" || (scenario.tool.name !== "write" && scenario.tool.name !== "edit")) return undefined
  return typeof scenario.tool.input.path === "string" ? scenario.tool.input.path : undefined
}

function scenarioState(scenario: PrototypeScenario) {
  return scenario.kind === "tool" ? scenario.tool.state.type : scenario.state
}

function detail(scenario: PrototypeScenario): JSX.Element | undefined {
  if (scenario.kind !== "tool") return undefined
  if (scenario.tool.state.type === "failed") return <p data-tone="danger">{scenario.tool.state.message}</p>
  if (scenario.tool.state.type !== "succeeded") return undefined
  if (scenario.tool.name === "shell" || scenario.tool.name === "execute") return output(scenario)
  if (!knownToolNames.has(scenario.tool.name)) return output(scenario)
  return undefined
}

function output(scenario: ToolScenario) {
  const result = scenario.tool.state.type === "succeeded" ? scenario.tool.state.result : undefined
  const stdout = result && typeof result === "object" && !Array.isArray(result) ? Reflect.get(result, "stdout") : undefined
  const value = typeof stdout === "string" ? stdout : scenario.tool.state.type === "succeeded" ? scenario.tool.state.output : undefined
  return value ? <pre>{value}</pre> : undefined
}

const knownToolNames = new Set(["read", "list", "glob", "grep", "write", "edit", "shell", "execute", "skill", "subagent"])
