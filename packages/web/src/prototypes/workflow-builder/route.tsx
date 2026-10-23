import { Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Button } from "../../ui/components/button"
import { Icon } from "../../ui/components/icon"
import { Select } from "../../ui/components/select"
import { TextInput } from "../../ui/components/text-input"
import { Textarea } from "../../ui/components/textarea"
import "./route.css"

type Simulation = "idle" | "match" | "miss"
type PolicyType = "guardrail" | "route"
type PolicyEffect = "allow" | "deny"

const policyTypes = ["guardrail", "route"] as const satisfies readonly PolicyType[]
const policyEffects = ["allow", "deny"] as const satisfies readonly PolicyEffect[]
const routeActions = ["model.request", "provider.request"] as const

export function WorkflowBuilderPrototypeRoute(): JSX.Element {
  const [state, setState] = createStore({
    name: "Shell tool restriction",
    type: "guardrail" as "guardrail" | "route",
    action: "tool.execute",
    resource: "shell",
    effect: "deny" as "allow" | "deny",
    target: "anthropic/claude-sonnet-4",
    message: "Shell access is disabled.",
    simulation: "idle" as Simulation,
  })
  const simulate = (simulation: Exclude<Simulation, "idle">) => setState("simulation", simulation)
  const outcome = () => {
    if (state.simulation === "miss") return "Allow"
    if (state.type === "route") return "Route"
    return title(state.effect)
  }

  return (
    <main data-component="policy-flow-prototype" data-simulation={state.simulation}>
      <header data-slot="policy-flow-topbar">
        <div data-slot="policy-flow-title">
          <Button as="a" href="/" aria-label="Back to ByMorning" variant="ghost-muted" icon="central-arrow-left" />
          <div>
            <span>Policies</span>
            <div data-slot="policy-flow-name">
              <TextInput aria-label="Policy name" appearance="full-width" value={state.name} onInput={(event) => setState("name", event.currentTarget.value)} />
            </div>
          </div>
        </div>
        <div data-slot="policy-flow-actions">
          <Show when={state.simulation !== "idle"}><span role="status" data-slot="simulation-status"><Icon name="check" /> {state.simulation === "match" ? "Rule matched" : "No match"}</span></Show>
          <Button variant="outline" data-slot="policy-flow-simulate" onClick={() => simulate("match")}>Simulate</Button>
          <Button variant="primary" disabled title="This isolated prototype does not save data">Publish policy</Button>
        </div>
      </header>

      <div data-slot="policy-builder">
        <section data-slot="policy-canvas" aria-label="Policy decision flow">
          <div data-slot="canvas-meta"><span>Enabled</span><b>1 rule</b><small>Last matching guardrail and route win independently</small></div>
          <div data-slot="policy-graph">
            <div data-component="policy-node" data-kind="request">
              <span data-slot="policy-node-icon">↗</span>
              <span data-slot="policy-node-copy"><small>REQUEST</small><strong>Tool call enters the gateway</strong><span>Evaluate Workspace policies in order</span></span>
              <Icon name="outline-dots" />
            </div>

            <div data-slot="policy-connector" aria-hidden="true"><span /></div>

            <div data-component="policy-node" data-kind="condition" data-selected>
              <span data-slot="policy-node-icon">IF</span>
              <span data-slot="policy-node-copy"><small>RULE 1 · {state.type.toUpperCase()}</small><strong>Do both patterns match?</strong><span data-slot="rule-expression"><code>{state.action || "action pattern"}</code><i>and</i><code>{state.resource || "resource pattern"}</code></span></span>
              <Icon name="outline-dots" />
            </div>

            <div data-slot="branch-lines" aria-hidden="true"><span /><i /><b /></div>
            <div data-slot="policy-branches">
              <section data-slot="policy-branch" data-path="match">
                <div data-slot="branch-label"><span>YES</span> Match</div>
                <button type="button" data-component="policy-node" data-kind="match" aria-pressed={state.simulation === "match"} onClick={() => simulate("match")}>
                  <span data-slot="policy-node-icon">{state.type === "route" ? "→" : effectGlyph(state.effect)}</span>
                  <span data-slot="policy-node-copy"><small>{state.type === "route" ? "ROUTE" : "CANDIDATE EFFECT"}</small><strong>{state.type === "route" ? `Route to ${state.target || "target"}` : title(state.effect)}</strong><span>{state.type === "route" ? "Set the model destination" : state.message || effectDescription(state.effect)}</span></span>
                </button>
              </section>
              <section data-slot="policy-branch" data-path="miss">
                <div data-slot="branch-label"><span>NO</span> No match</div>
                <button type="button" data-component="policy-node" data-kind="miss" aria-pressed={state.simulation === "miss"} onClick={() => simulate("miss")}>
                  <span data-slot="policy-node-icon">···</span>
                  <span data-slot="policy-node-copy"><small>FALL THROUGH</small><strong>Keep current decision</strong><span>This rule makes no change</span></span>
                </button>
              </section>
            </div>

            <div data-slot="merge-lines" aria-hidden="true"><span /><i /><b /></div>
            <div data-component="policy-node" data-kind="continue">
              <span data-slot="policy-node-icon">↓</span>
              <span data-slot="policy-node-copy"><small>POLICY EVALUATOR</small><strong>Continue through ordered rules</strong><span>After the final rule, apply the selected guardrail and route</span></span>
              <span data-slot="outcome-pill" data-effect={state.simulation === "miss" ? "allow" : state.type === "route" ? "route" : state.effect}>{state.simulation === "idle" ? "Final decision" : outcome()}</span>
            </div>

            <div data-slot="simulation-controls" aria-label="Simulation input">
              <span>Try a request</span>
              <Button size="small" variant="ghost-muted" aria-pressed={state.simulation === "match"} data-expanded={state.simulation === "match" ? "" : undefined} onClick={() => simulate("match")}>Matches rule</Button>
              <Button size="small" variant="ghost-muted" aria-pressed={state.simulation === "miss"} data-expanded={state.simulation === "miss" ? "" : undefined} onClick={() => simulate("miss")}>Does not match</Button>
            </div>
          </div>
        </section>

        <aside data-slot="policy-inspector" aria-label="Rule inspector">
          <header>
            <div><span data-slot="inspector-icon">IF</span><span><small>RULE 1</small><strong>{state.type === "guardrail" ? "Guardrail" : "Route"}</strong></span></div>
          </header>
          <div data-slot="inspector-content">
            <div data-slot="inspector-note"><Icon name="branch" /><p>Patterns use wildcards. Both action and resource must match for this rule to apply.</p></div>
            <label>Type
              <Select
                aria-label="Type"
                appearance="full-width"
                options={[...policyTypes]}
                current={state.type}
                label={title}
                onSelect={(type) => {
                  if (!type) return
                  setState({
                    type,
                    action: type === "route" && state.action !== "model.request" && state.action !== "provider.request"
                      ? "model.request"
                      : state.action,
                  })
                }}
              />
            </label>
            <label>Action
              <Show
                when={state.type === "guardrail"}
                fallback={
                  <Select
                    aria-label="Action"
                    appearance="full-width"
                    options={[...routeActions]}
                    current={state.action as (typeof routeActions)[number]}
                    onSelect={(action) => {
                      if (!action) return
                      setState({ action, target: action === "provider.request" ? "anthropic" : "anthropic/claude-sonnet-4" })
                    }}
                  />
                }
              >
                <TextInput appearance="full-width" value={state.action} list="prototype-policy-actions" onInput={(event) => setState("action", event.currentTarget.value)} />
              </Show>
            </label>
            <datalist id="prototype-policy-actions"><option value="tool.execute" /><option value="model.request" /><option value="provider.request" /><option value="model.use" /><option value="provider.use" /><option value="model.tool" /><option value="tool.combine" /></datalist>
            <label>Resource
              <TextInput appearance="full-width" value={state.resource} onInput={(event) => setState("resource", event.currentTarget.value)} />
              <small>Use <code>*</code> to match any sequence.</small>
            </label>
            <Show
              when={state.type === "guardrail"}
              fallback={
                <label>Target
                  <TextInput appearance="full-width" value={state.target} onInput={(event) => setState("target", event.currentTarget.value)} />
                </label>
              }
            >
              <label>Then
                <Select
                  aria-label="Then"
                  appearance="full-width"
                  options={[...policyEffects]}
                  current={state.effect}
                  label={title}
                  onSelect={(effect) => effect && setState("effect", effect)}
                />
              </label>
              <Show when={state.effect !== "allow"}>
                <label>Message
                  <Textarea rows="3" appearance="full-width" value={state.message} onInput={(event) => setState("message", event.currentTarget.value)} />
                </label>
              </Show>
            </Show>
          </div>
          <footer><span>Local prototype · changes are not saved</span></footer>
        </aside>
      </div>
    </main>
  )
}

function effectGlyph(effect: "allow" | "deny") {
  if (effect === "allow") return "✓"
  return "×"
}

function effectDescription(effect: "allow" | "deny") {
  if (effect === "allow") return "Allow the request to continue"
  return "Block the request"
}

function title(value: string) {
  return value[0]!.toUpperCase() + value.slice(1)
}
