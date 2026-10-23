import type { UsageOverviewOutput, UsageRecordsOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Title,
  Tooltip,
  type ChartConfiguration,
} from "chart.js"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"

import { useData, type QueryState } from "../../context/data"
import { useSDK } from "../../context/sdk"
import { useWorkspace } from "../../context/workspace"
import { Persist, persisted } from "../../runtime/persistence/storage"
import { copyToClipboard } from "../../ui/clipboard"
import { Button } from "../../ui/components/button"
import { Empty } from "../../ui/components/empty"
import { showToast } from "../../ui/components/toast"
import { formatCompact, formatDollars, formatRelativeTime, formatSpend } from "../../ui/format"
import { useTheme } from "../../ui/theme"
import { RequestLog, RequestLogIdentity, RequestLogTable } from "../../console/request-log"
import { GatewayModelIdentity } from "../model-identity"
import { WorkspacePage } from "../../home/workspace-page"
import { GatewayMetric } from "../page"
import "./route.css"

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Title)

const ranges = [7, 30, 90] as const
type Range = (typeof ranges)[number]

export function GatewayOverviewRoute(): JSX.Element {
  const sdk = useSDK()
  const data = useData()
  const workspace = useWorkspace()
  const [range, setRange] = createSignal<Range>(30)
  const [pagination, setPagination] = createStore<{ cursor: string | undefined; history: Array<string | undefined> }>({
    cursor: undefined,
    history: [],
  })
  // Browser-local, like Picker Visibility: which metric the chart shows outlives a reload.
  const metricStore = createStore<{ metric: UsageMetric }>({ metric: "cost" })
  const [metric, setMetric] = persisted<{ metric: UsageMetric }, typeof metricStore>(
    Persist.workspace(workspace.current().id, "gateway-overview-metric.v1"),
    metricStore,
  )
  const usage = data.gateway.usage(() => ({ days: range() }))
  const requestLog = data.gateway.records(() => ({ limit: 50, cursor: pagination.cursor }))
  onMount(() => void data.workspace.model.sync().catch(() => undefined))
  return (
    <GatewayOverviewPage
      endpoint={new URL("inference", sdk.baseURL).href}
      range={range}
      usage={() => usage.state()}
      requestLog={() => requestLog.state()}
      onRangeChange={setRange}
      onUsageRetry={() => usage.refetch()}
      onRequestLogRetry={() => requestLog.refetch()}
      canGoPrevious={() => pagination.history.length > 0}
      onPrevious={() => setPagination({ cursor: pagination.history.at(-1), history: pagination.history.slice(0, -1) })}
      onNext={() => {
        const page = requestLog.state().data
        if (page?.cursor === undefined) return
        setPagination({ cursor: page.cursor, history: [...pagination.history, pagination.cursor] })
      }}
      model={(id) => {
        const match = data.workspace.model
          .rows()
          .find((model) => model.info.id === id || `${model.info.provider}/${model.info.id}` === id)
        return match === undefined ? undefined : { name: match.info.name, provider: match.info.provider }
      }}
      metric={() => metric.metric}
      onMetricChange={(next) => setMetric("metric", next)}
    />
  )
}

export function GatewayOverviewPage(props: {
  readonly endpoint: string
  readonly range: () => Range
  readonly usage: () => QueryState<UsageOverviewOutput>
  readonly requestLog: () => QueryState<UsageRecordsOutput>
  readonly onRangeChange: (range: Range) => void
  readonly onUsageRetry: () => void
  readonly onRequestLogRetry: () => void
  readonly canGoPrevious: () => boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly model?: ModelLookup
  readonly metric: () => UsageMetric
  readonly onMetricChange: (metric: UsageMetric) => void
}): JSX.Element {
  const [copyState, setCopyState] = createStore({ copied: false, error: "" })
  const state = createMemo(props.usage)
  let copyReset: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(copyReset))

  createEffect(
    on(
      () => {
        const current = state()
        return current.state === "error" ? current : undefined
      },
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: props.onUsageRetry }],
        })
      },
    ),
  )
  createEffect(
    on(
      () => {
        const current = props.requestLog()
        return current.state === "error" ? current : undefined
      },
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: props.onRequestLogRetry }],
        })
      },
    ),
  )

  const copyEndpoint = () => {
    setCopyState({ copied: false, error: "" })
    clearTimeout(copyReset)
    void copyToClipboard(props.endpoint).then((result) => {
      if (result !== "copied") {
        setCopyState("error", "Could not copy the endpoint.")
        return
      }
      setCopyState("copied", true)
      copyReset = setTimeout(() => setCopyState("copied", false), 2_000)
    })
  }
  const data = () => {
    const current = state()
    return current.state === "ready" ? current.data : undefined
  }
  const loading = () => {
    const current = state().state
    return current === "loading" || current === "idle"
  }
  return (
    <WorkspacePage title="Overview" layout="table">
      <div data-component="gateway-page">
      <section data-slot="gateway-endpoint" aria-label="Inference endpoint">
        <div data-slot="gateway-endpoint-value">
          <code>{props.endpoint}</code>
          <div data-slot="gateway-endpoint-copy">
            <Button type="button" icon="outline-copy" onClick={copyEndpoint}>
              Copy endpoint
            </Button>
          </div>
        </div>
        <p data-slot="gateway-endpoint-announcement" role="status" aria-live="polite">
          {copyState.copied ? "Endpoint copied." : ""}
        </p>
        <Show when={copyState.error}>
          {(message) => (
            <p role="alert" data-slot="gateway-endpoint-error">
              {message()}
            </p>
          )}
        </Show>
      </section>

      <section data-component="gateway-usage" aria-labelledby="usage-title">
        <div data-slot="section-heading">
          <div>
            <h2 id="usage-title">Usage overview</h2>
          </div>
          <div data-slot="controls" aria-label="Usage date range">
            <For each={ranges}>
              {(range) => (
                <Button
                  type="button"
                  size="small"
                  variant={props.range() === range ? "neutral" : "ghost"}
                  aria-pressed={props.range() === range}
                  onClick={() => props.onRangeChange(range)}
                >
                  {range} days
                </Button>
              )}
            </For>
          </div>
        </div>

        <Switch>
          <Match when={loading()}>
            <p role="status" aria-label="Loading usage overview" data-slot="overview-status">
              Loading usage for {props.range()} days…
            </p>
          </Match>
          <Match when={data()}>
            {(data) => (
              <OverviewContent data={data()} metric={props.metric()} onMetricChange={props.onMetricChange} />
            )}
          </Match>
        </Switch>
      </section>

      <GatewayRequestLog
        state={props.requestLog}
        canGoPrevious={props.canGoPrevious}
        onRetry={props.onRequestLogRetry}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        {...(props.model === undefined ? {} : { model: props.model })}
      />
      </div>
    </WorkspacePage>
  )
}

function GatewayRequestLog(props: {
  readonly state: () => QueryState<UsageRecordsOutput>
  readonly canGoPrevious: () => boolean
  readonly onRetry: () => void
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly model?: ModelLookup
}) {
  const data = () => {
    const state = props.state()
    return state.state === "ready" ? state.data : undefined
  }
  const loading = () => {
    const current = props.state().state
    return current === "loading" || current === "idle"
  }
  return (
    <RequestLog
      loading={loading()}
      ready={data() !== undefined}
      empty={data() !== undefined && data()!.data.length === 0}
      emptyLabel="No requests"
      canGoPrevious={props.canGoPrevious()}
      canGoNext={data()?.cursor !== undefined}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
    >
      <RequestLogTable>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Model</th>
            <th scope="col" data-align="end">
              Input
            </th>
            <th scope="col" data-align="end">
              Cache Read
            </th>
            <th scope="col" data-align="end">
              Cache Write
            </th>
            <th scope="col" data-align="end">
              Output
            </th>
            <th scope="col" data-align="end">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={data()?.data}>
            {(record) => {
              // A record stores the model as a string; the catalog knows which Provider serves it.
              // Prefer that so the row shows the same icon as the Models table, and only parse the
              // string for models the catalog no longer lists. Read through a function, not a value
              // computed once here, so a row upgrades once the catalog finishes loading.
              const model = () => props.model?.(record.model) ?? modelParts(record.model)
              return (
                <tr>
                  <td>
                    <time dateTime={record.createdAt.toISOString()} title={record.createdAt.toLocaleString()}>
                      {formatRelativeTime(record.createdAt)}
                    </time>
                  </td>
                  <RequestLogIdentity title={record.model}>
                    <GatewayModelIdentity
                      provider={model().provider}
                      name={model().name}
                      id={record.model}
                      showID={false}
                    />
                  </RequestLogIdentity>
                  <td data-align="end">{formatNumber(record.usage.tokens.input)}</td>
                  <td data-align="end">{formatExactCached(record.usage.tokens.cache.read)}</td>
                  <td data-align="end">{formatExactCached(record.usage.tokens.cache.write)}</td>
                  <td data-align="end" title={outputBreakdown(record.usage.tokens)}>
                    {formatNumber(record.usage.tokens.output + record.usage.tokens.reasoning)}
                  </td>
                  <td data-align="end">
                    <Spend usage={record.usage} precise />
                  </td>
                </tr>
              )
            }}
          </For>
        </tbody>
      </RequestLogTable>
    </RequestLog>
  )
}

/** Catalog identity for a model string a request recorded, when the catalog still lists it. */
type ModelLookup = (id: string) => { readonly name: string; readonly provider: Provider.Name } | undefined

function modelParts(model: string) {
  const separator = model.indexOf("/")
  if (separator === -1) return { provider: Provider.Name.make(model), name: model }
  return { provider: Provider.Name.make(model.slice(0, separator)), name: model.slice(separator + 1) }
}

/** One series the Overview can chart. The order here is the card order. */
export type UsageMetric = "cost" | "requests" | "tokens"
export const usageMetrics: ReadonlyArray<UsageMetric> = ["cost", "requests", "tokens"]

type Aggregate = UsageOverviewOutput["total"]

const metricCopy: Record<
  UsageMetric,
  { readonly label: string; readonly value: (usage: Aggregate) => number; readonly format: (value: number) => string }
> = {
  cost: { label: "Total cost", value: (usage) => usage.cost, format: formatDollars },
  requests: { label: "Requests", value: (usage) => usage.invocations, format: formatNumber },
  tokens: { label: "Tokens", value: (usage) => usage.tokens.total, format: formatTokenCount },
}

function OverviewContent(props: {
  readonly data: UsageOverviewOutput
  readonly metric: UsageMetric
  readonly onMetricChange: (metric: UsageMetric) => void
}): JSX.Element {
  const empty = () => props.data.total.invocations === 0
  const chartLabel = () => `Daily ${metricCopy[props.metric].label.toLowerCase()}`
  return (
    <Show
      when={!empty()}
      fallback={<Empty label="No usage for selected period" variant="panel">No usage</Empty>}
    >
      <div data-component="gateway-overview-results">
        <div data-slot="metric-grid" role="tablist" aria-label="Chart metric">
          <For each={usageMetrics}>
            {(metric) => (
              <GatewayMetric
                label={metricCopy[metric].label}
                value={
                  metric === "cost" ? (
                    <Spend usage={props.data.total} />
                  ) : (
                    metricCopy[metric].format(metricCopy[metric].value(props.data.total))
                  )
                }
                selected={props.metric === metric}
                onSelect={() => props.onMetricChange(metric)}
              />
            )}
          </For>
        </div>

        <section data-slot="card" role="tabpanel" aria-label={chartLabel()}>
          <UsageChart daily={props.data.daily} metric={props.metric} />
        </section>
      </div>
    </Show>
  )
}

function UsageChart(props: { readonly daily: UsageOverviewOutput["daily"]; readonly metric: UsageMetric }) {
  let canvas!: HTMLCanvasElement
  let viewport!: HTMLDivElement
  const theme = useTheme()
  const copy = () => metricCopy[props.metric]
  const label = () => `Daily ${copy().label.toLowerCase()}`

  createEffect(
    on(
      () => props.daily,
      () => {
        const frame = requestAnimationFrame(() => {
          viewport.scrollLeft = viewport.scrollWidth
        })
        onCleanup(() => cancelAnimationFrame(frame))
      },
    ),
  )

  createEffect(() => {
    theme.theme()
    theme.mode()
    const daily = props.daily
    const metric = copy()
    if (typeof CanvasRenderingContext2D === "undefined") return

    const style = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
    const chart = new Chart(
      canvas,
      usageChartConfiguration({
        label: metric.label,
        format: metric.format,
        dates: daily.map((day) => day.date),
        values: daily.map((day) => metric.value(day.usage)),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        theme: {
          text: token("--color-text-base", "#161616"),
          textMuted: token("--color-text-muted", "#5c5c5c"),
          textFaint: token("--color-text-faint", "#808080"),
          border: token("--color-border-base", "rgba(0, 0, 0, 0.1)"),
          background: token("--color-bg-layer-1", "#ffffff"),
          accent: token("--color-text-accent", "#ee8a3e"),
          accentHover: token("--color-text-accent-hover", "#d9762f"),
          font: token("--font-mono", "monospace"),
        },
      }),
    )
    onCleanup(() => chart.destroy())
  })

  return (
    <>
      <div
        ref={viewport}
        data-slot="chart-viewport"
        tabIndex={0}
        aria-label={`${label()} chart; scroll horizontally to view all dates`}
      >
        <div data-slot="usage-chart">
          <canvas ref={canvas} role="img" aria-label={label()} aria-details="chart-values">
            {label()} for the selected period.
          </canvas>
        </div>
      </div>
      <table id="chart-values" class="sr-only">
        <caption>{label()} values</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{copy().label}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.daily}>
            {(day) => (
              <tr>
                <th scope="row">
                  <time dateTime={day.date}>{formatDateLabel(day.date)}</time>
                </th>
                <td>{copy().format(copy().value(day.usage))}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </>
  )
}

interface UsageChartTheme {
  readonly text: string
  readonly textMuted: string
  readonly textFaint: string
  readonly border: string
  readonly background: string
  readonly accent: string
  readonly accentHover: string
  readonly font: string
}

export function usageChartConfiguration(input: {
  readonly label: string
  readonly format: (value: number) => string
  readonly dates: ReadonlyArray<string>
  readonly values: ReadonlyArray<number>
  readonly reducedMotion: boolean
  readonly theme: UsageChartTheme
}): ChartConfiguration<"bar"> {
  const labels = input.dates.map(formatDateLabel)
  // Label every Nth day counting back from the latest so the newest bar is always named.
  const step = Math.max(1, Math.ceil(labels.length / 12))
  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: input.label,
          data: [...input.values],
          backgroundColor: input.theme.accent,
          hoverBackgroundColor: input.theme.accentHover,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: input.reducedMotion ? false : undefined,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback(_, index) {
              // Narrow charts label fewer days so neighbouring labels never overlap.
              const fit = this.chart?.width ? Math.ceil((labels.length * 72) / this.chart.width) : 1
              return (labels.length - 1 - index) % Math.max(step, fit) === 0 ? labels[index] : ""
            },
            color: input.theme.textFaint,
            font: { family: input.theme.font, size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          afterBuildTicks: (axis) => {
            const max = Math.max(0, ...input.values)
            // A single tick avoids showing the same formatted value twice when every value is zero.
            axis.ticks = max === 0 ? [{ value: 0 }] : [{ value: 0 }, { value: max }]
          },
          grid: {
            color: input.theme.border,
            drawTicks: false,
          },
          border: { display: false, dash: [4, 4] },
          ticks: {
            color: input.theme.textFaint,
            font: { family: input.theme.font, size: 11 },
            callback: (value) => input.format(Number(value)),
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: input.label,
          align: "start",
          color: input.theme.text,
          font: { family: input.theme.font, size: 13, weight: "normal" },
          padding: { bottom: 16 },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: input.theme.background,
          titleColor: input.theme.text,
          bodyColor: input.theme.textMuted,
          borderColor: input.theme.border,
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          displayColors: false,
          callbacks: { label: (context) => `${input.label}: ${input.format(context.parsed.y ?? 0)}` },
        },
        legend: { display: false },
      },
    },
  }
}

function formatDateLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  })
}

const numbers = new Intl.NumberFormat()

function formatNumber(value: number) {
  return numbers.format(value)
}

export function formatTokenCount(value: number) {
  if (value <= 999) return formatNumber(value)
  return formatCompact(value).toUpperCase()
}

function formatExactCached(value: number) {
  return value === 0 ? "-" : formatNumber(value)
}

/** Output column sums visible and reasoning tokens, like OpenCode's usage table; the title keeps the split. */
function outputBreakdown(tokens: { readonly output: number; readonly reasoning: number }) {
  return `${formatNumber(tokens.output)} output + ${formatNumber(tokens.reasoning)} reasoning`
}

function Spend(props: {
  readonly usage: { readonly cost: number; readonly costComplete?: boolean }
  /** Four-decimal per-request precision instead of whole cents. */
  readonly precise?: boolean
}) {
  const value = () => (props.precise ? formatSpend : formatDollars)(props.usage.cost)
  if (props.usage.costComplete !== false) return value()
  return <span aria-label={`At least ${value()}; known subtotal; pricing incomplete`}>at least {value()}</span>
}
