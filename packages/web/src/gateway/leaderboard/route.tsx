import type { ModelInfo, UsageLeaderboardOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import { createEffect, createMemo, For, Match, on, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData, type QueryState } from "../../context/data"
import { Avatar } from "../../ui/components/avatar"
import { Button } from "../../ui/components/button"
import { Empty } from "../../ui/components/empty"
import { SegmentedControl, SegmentedControlItem } from "../../ui/components/segmented-control"
import { showToast } from "../../ui/components/toast"
import { formatCompact, formatDollars } from "../../ui/format"
import { WorkspacePage } from "../../home/workspace-page"
import { GatewayModelIdentity } from "../model-identity"
import "../page.css"
import "./route.css"

const ranges = [7, 30, 90] as const
const pageSize = 10
type Range = (typeof ranges)[number]

export function GatewayLeaderboardRoute(): JSX.Element {
  const data = useData()
  const [view, setView] = createStore<{ range: Range; page: number; expanded: Set<string> }>({
    range: 7,
    page: 0,
    expanded: new Set(),
  })
  const leaderboard = data.gateway.leaderboard(() => ({ days: view.range }))
  onMount(() => void data.workspace.model.sync().catch(() => undefined))
  return (
    <GatewayLeaderboardPage
      state={() => leaderboard.state()}
      range={() => view.range}
      page={() => view.page}
      expanded={() => view.expanded}
      onRangeChange={(range) => setView({ range, page: 0, expanded: new Set() })}
      onPageChange={(page) => setView("page", page)}
      onToggle={(id) =>
        setView("expanded", (expanded) => {
          const next = new Set(expanded)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      onRetry={() => leaderboard.refetch()}
      modelInfo={(id) => {
        const match = data.workspace.model
          .rows()
          .find((model) => model.info.id === id || `${model.info.provider}/${model.info.id}` === id)
        return match?.info
      }}
    />
  )
}

export function GatewayLeaderboardPage(props: {
  readonly state: () => QueryState<UsageLeaderboardOutput>
  readonly range: () => Range
  readonly page: () => number
  readonly expanded: () => ReadonlySet<string>
  readonly onRangeChange: (range: Range) => void
  readonly onPageChange: (page: number) => void
  readonly onToggle: (id: string) => void
  readonly onRetry: () => void
  readonly modelInfo?: (id: string) => Pick<ModelInfo, "name" | "provider"> | undefined
}): JSX.Element {
  const data = () => {
    const current = props.state()
    return current.state === "ready" ? current.data : undefined
  }
  const loading = () => {
    const current = props.state().state
    return current === "loading" || current === "idle"
  }
  const sortedUsers = createMemo(() => {
    return (data()?.users ?? []).toSorted((left, right) =>
      compareUsage(left.usage, right.usage, left.userID, right.userID),
    )
  })
  const sortedModels = createMemo(() => {
    return (data()?.models ?? []).toSorted((left, right) =>
      compareUsage(left.usage, right.usage, left.model, right.model),
    )
  })
  const pages = () => Math.max(1, Math.ceil(sortedUsers().length / pageSize))
  const pageRows = () => sortedUsers().slice(props.page() * pageSize, (props.page() + 1) * pageSize)
  // Shares are allocated over every member, not just the visible page, so pages agree with each other.
  const memberShares = createMemo(() => spendShares(sortedUsers().map((user) => user.usage.cost)))

  createEffect(
    on(
      () => {
        const current = props.state()
        return current.state === "error" ? current : undefined
      },
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: "Failed to load leaderboard.",
          actions: [{ label: "Try again", onClick: props.onRetry }],
        })
      },
    ),
  )

  return (
    <WorkspacePage
      title="Leaderboard"
      layout="table"
      actions={
        <SegmentedControl
          data-slot="range"
          aria-label="Leaderboard date range"
          value={props.range().toString()}
          onChange={(value) => {
            const range = ranges.find((range) => range.toString() === value)
            if (range !== undefined) props.onRangeChange(range)
          }}
        >
          <For each={ranges}>
            {(range) => <SegmentedControlItem value={range.toString()}>{range} days</SegmentedControlItem>}
          </For>
        </SegmentedControl>
      }
    >
      <div data-component="gateway-page">
        <Switch>
          <Match when={loading()}>
            <p role="status" data-slot="leaderboard-status">
              Loading leaderboard...
            </p>
          </Match>
          <Match when={data()}>
            <Show
              when={(data()?.users.length ?? 0) + (data()?.models.length ?? 0) > 0}
              fallback={<Empty variant="panel">No usage</Empty>}
            >
              <div data-component="leaderboard-layout">
                <ModelTable models={sortedModels} modelInfo={props.modelInfo} />
                <section data-component="leaderboard-main" aria-labelledby="member-leaderboard-title">
                  <h2 id="member-leaderboard-title">Members</h2>
                  <Show when={sortedUsers().length > 0} fallback={<Empty variant="panel">No member usage</Empty>}>
                    <div
                      data-slot="leaderboard-table-wrap"
                      tabIndex={0}
                      aria-label="Member leaderboard; scroll horizontally to view all columns"
                    >
                      <table aria-label="Member leaderboard">
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Member</th>
                            <th scope="col">Share of spend</th>
                            <th scope="col" data-align="end">
                              Spend
                            </th>
                            <th scope="col" data-align="end">
                              Tokens
                            </th>
                            <th scope="col">
                              <span class="sr-only">Details</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={pageRows()}>
                            {(user, index) => {
                              const open = () => props.expanded().has(user.userID)
                              const share = () => memberShares()[props.page() * pageSize + index()] ?? 0
                              return (
                                <>
                                  <tr>
                                    <td data-slot="rank">{props.page() * pageSize + index() + 1}</td>
                                    <th scope="row">
                                      <MemberIdentity user={user} />
                                    </th>
                                    <td>
                                      <div data-slot="usage-share-cell">
                                        <progress
                                          data-slot="usage-share"
                                          value={share()}
                                          max={100}
                                          aria-label={`${share()}% of member spend`}
                                        />
                                        <span data-slot="usage-share-percent" aria-hidden="true">
                                          {share()}%
                                        </span>
                                      </div>
                                    </td>
                                    <td data-align="end">
                                      <CostValue usage={user.usage} />
                                    </td>
                                    <td data-align="end">{formatTokens(user.usage.tokens.total)}</td>
                                    <td data-align="end">
                                      <Button
                                        type="button"
                                        size="small"
                                        variant="ghost-muted"
                                        data-slot="disclosure"
                                        aria-expanded={open()}
                                        aria-label={`${open() ? "Collapse" : "Expand"} model usage for ${identity(user)}`}
                                        onClick={() => props.onToggle(user.userID)}
                                      >
                                        {open() ? "−" : "+"}
                                      </Button>
                                    </td>
                                  </tr>
                                  <Show when={open()}>
                                    <tr data-slot="expanded-row">
                                      <td colSpan={6}>
                                        <table aria-label={`Models used by ${identity(user)}`}>
                                          <thead>
                                            <tr>
                                              <th scope="col">Model</th>
                                              <th scope="col" data-align="end">
                                                Spend
                                              </th>
                                              <th scope="col" data-align="end">
                                                Tokens
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            <For each={user.models}>
                                              {(model) => (
                                                <tr>
                                                  <th scope="row">
                                                    <ModelIdentity model={model.model} modelInfo={props.modelInfo} />
                                                  </th>
                                                  <td data-align="end">
                                                    <CostValue usage={model.usage} />
                                                  </td>
                                                  <td data-align="end">{formatTokens(model.usage.tokens.total)}</td>
                                                </tr>
                                              )}
                                            </For>
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  </Show>
                                </>
                              )
                            }}
                          </For>
                        </tbody>
                      </table>
                    </div>
                    <Show when={pages() > 1}>
                      <nav data-slot="leaderboard-pagination" aria-label="Leaderboard pages">
                        <span>
                          Page {props.page() + 1} of {pages()}
                        </span>
                        <div>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost-muted"
                            disabled={props.page() === 0}
                            onClick={() => props.onPageChange(props.page() - 1)}
                          >
                            Prev
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost-muted"
                            disabled={props.page() + 1 >= pages()}
                            onClick={() => props.onPageChange(props.page() + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </nav>
                    </Show>
                  </Show>
                </section>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}

function ModelTable(props: {
  readonly models: () => UsageLeaderboardOutput["models"]
  readonly modelInfo: ((id: string) => Pick<ModelInfo, "name" | "provider"> | undefined) | undefined
}) {
  const shares = createMemo(() => spendShares(props.models().map((model) => model.usage.cost)))
  return (
    <section data-component="leaderboard-main" aria-labelledby="model-leaderboard-title">
      <h2 id="model-leaderboard-title">Models</h2>
      <Show when={props.models().length > 0} fallback={<Empty variant="panel">No model usage</Empty>}>
        <div
          data-slot="leaderboard-table-wrap"
          tabIndex={0}
          aria-label="Model leaderboard; scroll horizontally to view all columns"
        >
          <table aria-label="Model leaderboard">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Model</th>
                <th scope="col">Share of spend</th>
                <th scope="col" data-align="end">
                  Users
                </th>
                <th scope="col" data-align="end">
                  Spend
                </th>
                <th scope="col" data-align="end">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={props.models()}>
                {(model, index) => {
                  const share = () => shares()[index()] ?? 0
                  return (
                    <tr>
                      <td data-slot="rank">{index() + 1}</td>
                      <th scope="row">
                        <ModelIdentity model={model.model} modelInfo={props.modelInfo} />
                      </th>
                      <td>
                        <div data-slot="usage-share-cell">
                          <progress
                            data-slot="usage-share"
                            value={share()}
                            max={100}
                            aria-label={`${share()}% of model spend`}
                          />
                          <span data-slot="usage-share-percent" aria-hidden="true">
                            {share()}%
                          </span>
                        </div>
                      </td>
                      <td data-align="end">{model.users}</td>
                      <td data-align="end">
                        <CostValue usage={model.usage} />
                      </td>
                      <td data-align="end">{formatTokens(model.usage.tokens.total)}</td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  )
}

function MemberIdentity(props: { readonly user: UsageLeaderboardOutput["users"][number] }) {
  return (
    <div data-slot="member-identity">
      <Avatar size="small" fallback={identity(props.user)} />
      <strong>{identity(props.user)}</strong>
    </div>
  )
}

function ModelIdentity(props: {
  readonly model: string
  readonly modelInfo: ((id: string) => Pick<ModelInfo, "name" | "provider"> | undefined) | undefined
}) {
  const model = () => modelParts(props.model)
  const info = createMemo(() => props.modelInfo?.(props.model))
  return (
    <GatewayModelIdentity
      provider={info()?.provider ?? model().provider}
      name={info()?.name ?? model().name}
      id={props.model}
    />
  )
}

function identity(user: UsageLeaderboardOutput["users"][number]) {
  return user.email ?? "Unknown member"
}

function modelParts(model: string) {
  const separator = model.indexOf("/")
  if (separator === -1) return { provider: Provider.Name.make(model), name: model }
  return { provider: Provider.Name.make(model.slice(0, separator)), name: model.slice(separator + 1) }
}

function compareUsage(
  left: UsageLeaderboardOutput["models"][number]["usage"],
  right: UsageLeaderboardOutput["models"][number]["usage"],
  leftID: string,
  rightID: string,
) {
  return right.cost - left.cost || leftID.localeCompare(rightID)
}

function CostValue(props: {
  readonly usage: {
    readonly cost: number
    readonly costComplete?: boolean
  }
}) {
  const cost = () => formatDollars(props.usage.cost)
  return (
    <Show
      when={props.usage.costComplete !== false}
      fallback={<span aria-label={`At least ${cost()}; known subtotal; pricing incomplete`}>at least {cost()}</span>}
    >
      {cost()}
    </Show>
  )
}

function formatTokens(value: number) {
  return value < 1_000 ? value.toLocaleString() : formatCompact(value).toUpperCase()
}

/**
 * Each row's whole-number share of the total, allocated so the column sums to exactly 100.
 *
 * Rounding rows independently drifts to 99 or 101 whenever several small rows sit under
 * one large one; largest-remainder hands the leftover points to the rows that were closest
 * to rounding up. All zeros when nothing in the period carried a price.
 */
export function spendShares(costs: ReadonlyArray<number>): ReadonlyArray<number> {
  const total = costs.reduce((sum, cost) => sum + cost, 0)
  if (total <= 0) return costs.map(() => 0)
  const exact = costs.map((cost) => (cost / total) * 100)
  const shares = exact.map(Math.floor)
  let remaining = 100 - shares.reduce((sum, share) => sum + share, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - shares[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const { index } of byRemainder) {
    if (remaining <= 0) break
    shares[index]!++
    remaining--
  }
  return shares
}
