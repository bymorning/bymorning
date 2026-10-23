import { createVirtualizer, defaultRangeExtractor, elementScroll, type VirtualItem } from "@tanstack/solid-virtual"
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"

import { Button } from "../../../ui/components/button"
import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import { ScrollView } from "../../../ui/scroll-view"
import { useI18n } from "../../../ui/context/i18n"
import type { SessionUI } from "../ui/session-model"
import type { TimelineInteraction } from "./interaction"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"

const fallbackItemSize = 60
const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'
type CachedMeasurement = { readonly key: string; readonly size: number }
type CacheEntry = {
  readonly version: 1
  readonly measurements: CachedMeasurement[]
  readonly disclosure: Record<string, boolean | undefined>
}
type LegacyCacheEntry = {
  readonly measurements: VirtualItem[]
  readonly disclosure: Record<string, boolean | undefined>
}
const cache = new Map<string, CacheEntry | LegacyCacheEntry>()

export const timelineEstimatedItemSize = fallbackItemSize
export const timelineInitialOverscan = (cached: boolean, coldBottom: boolean) => (cached || coldBottom ? 6 : 20)

/** Keep virtualizer geometry on whole pixels so subpixel measure noise cannot oscillate total size. */
export function timelineMeasuredSize(raw: number, previous: number | undefined) {
  if (previous !== undefined && Math.abs(raw - previous) < 1) return previous
  return Math.round(raw)
}

export function timelineCachedMeasurements(
  rows: ReadonlyArray<Pick<SessionUI.TimelineRow, "key">>,
  entry: CacheEntry | LegacyCacheEntry | undefined,
) {
  if (!entry || !("version" in entry) || entry.version !== 1) return []
  const sizeByKey = new Map(entry.measurements.map((measurement) => [measurement.key, measurement.size]))
  return rows.flatMap((row, index) => {
    const size = sizeByKey.get(row.key)
    if (size === undefined) return []
    return [{ index, key: row.key, start: 0, size, end: size, lane: 0 } satisfies VirtualItem]
  })
}

export interface TimelineDisclosure {
  value(key: string): boolean | undefined
  set(key: string, open: boolean): void
}

export function TimelineOlderError(props: {
  readonly error: string | undefined
  readonly loading: boolean
  readonly retry: () => Promise<boolean>
}) {
  const i18n = useI18n()
  return (
    <Show when={props.error}>
      {(error) => (
        <div data-slot="timeline-older-error" role="alert">
          <span title={error()}>{error()}</span>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={props.loading}
            onClick={() => void props.retry()}
          >
            {i18n.t("ui.common.retry")}
          </Button>
        </div>
      )}
    </Show>
  )
}

export function timelineVirtualIndexes(
  range: { readonly startIndex: number; readonly endIndex: number; readonly overscan: number; readonly count: number },
  forced: ReadonlyArray<number | undefined>,
) {
  return [
    ...new Set([...defaultRangeExtractor(range), ...forced.filter((index): index is number => index !== undefined)]),
  ]
    .filter((index) => index >= 0 && index < range.count)
    .sort((left, right) => left - right)
}

export function TimelineVirtualizer(props: {
  readonly sessionKey: string
  readonly rows: ReadonlyArray<SessionUI.TimelineRow>
  readonly rowByKey: ReadonlyMap<string, SessionUI.TimelineRow>
  readonly messageFirstRowIndex: ReadonlyMap<string, number>
  readonly activeLastRowKey?: string
  readonly header?: JSX.Element
  readonly footer?: JSX.Element
  readonly interaction: TimelineInteraction
  readonly renderRow: (
    row: Accessor<SessionUI.TimelineRow>,
    onSizeChange: () => void,
    disclosure: TimelineDisclosure,
  ) => JSX.Element
}): JSX.Element {
  const i18n = useI18n()
  let cacheSessionKey = props.sessionKey
  const cached = cache.get(cacheSessionKey)
  const initialMeasurements = timelineCachedMeasurements(props.rows, cached)
  const coldBottomMount = !initialMeasurements?.length && props.interaction.pinned()
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [focusedRowKey, setFocusedRowKey] = createSignal<string>()
  const [disclosure, setDisclosure] = createStore<Record<string, boolean | undefined>>(cached?.disclosure ?? {})
  const [renderOverscan, setRenderOverscan] = createSignal(
    timelineInitialOverscan(!!initialMeasurements?.length, coldBottomMount),
  )
  const [footerHeight, setFooterHeight] = createSignal(0)
  const rows = () => props.rows
  const rowByKey = () => props.rowByKey
  const measuredSizes = new Map(initialMeasurements.map((measurement) => [String(measurement.key), measurement.size]))
  const knownKeys = new Set(rows().map((row) => row.key))
  const addedKeys = new Set<string>()
  let rowsSessionKey = props.sessionKey
  let virtualContent: HTMLDivElement | undefined
  let resizeAnchorScheduled = false
  let focusFrame: number | undefined
  let overscanFrame: number | undefined
  let anchorFrame: number | undefined
  let measurementFrame: number | undefined
  let viewportAnchor: { readonly key: string; readonly top: number } | undefined

  // ByMorning can regroup and re-key the leading projected turn when a page arrives. Preserve
  // a visible stable sibling because TanStack cannot anchor through the removed boundary key.
  const rememberViewportAnchor = () => {
    const root = viewport()
    if (!root || props.interaction.pinned()) return
    const view = root.getBoundingClientRect()
    const mounted = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
    // Prefer a stable sibling for regrouped history, but a tall message can fill
    // the entire viewport. In that case track it instead of retaining an old row.
    const anchor =
      mounted.find((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= view.top + (props.header ? 84 : 20) && rect.bottom <= view.bottom - 20
      }) ??
      mounted.find((row) => {
        const rect = row.getBoundingClientRect()
        return rect.bottom > view.top + (props.header ? 84 : 20) && rect.top < view.bottom - 20
      })
    if (!anchor?.dataset.timelineKey) return
    viewportAnchor = { key: anchor.dataset.timelineKey, top: anchor.getBoundingClientRect().top - view.top }
  }
  const restoreViewportAnchor = (anchor: NonNullable<typeof viewportAnchor>) => {
    const root = viewport()
    const current = root?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.key)}"]`)
    if (!root || !current || props.interaction.pinned()) return
    const delta = current.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.top
    if (Math.abs(delta) > 1) virtualizer.scrollToOffset(root.scrollTop + delta)
    return delta
  }

  let observedRows = rows()
  createComputed(() => {
    const next = rows()
    if (next === observedRows) return
    observedRows = next
    const root = viewport()
    const anchor = viewportAnchor
    if (!root || !anchor || props.interaction.pinned()) return
    if (anchorFrame !== undefined) cancelAnimationFrame(anchorFrame)
    let stable = 0
    const restore = () => {
      const delta = restoreViewportAnchor(anchor)
      if (delta === undefined) {
        anchorFrame = undefined
        return
      }
      // scrollTop is rounded to device pixels; subpixel residuals must settle.
      stable = Math.abs(delta) <= 1 ? stable + 1 : 0
      if (stable >= 4 && !root.querySelector(pendingMarkdown)) {
        anchorFrame = undefined
        viewportAnchor = anchor
        return
      }
      anchorFrame = requestAnimationFrame(restore)
    }
    queueMicrotask(restore)
  })

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => viewport() ?? null,
    observeElementOffset: (instance, callback) =>
      observeElementOffsetReconnectAware(instance, callback, () => {
        if (props.interaction.pinned()) virtualizer.scrollToEnd()
      }),
    initialOffset: () => (props.interaction.pinned() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => fallbackItemSize,
    scrollToFn: (offset, options, instance) => {
      if (virtualContent) virtualContent.style.height = `${Math.round(instance.getTotalSize())}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      const items = rows()
      if (rowsSessionKey !== props.sessionKey) {
        rowsSessionKey = props.sessionKey
        knownKeys.clear()
        addedKeys.clear()
        items.forEach((row) => knownKeys.add(row.key))
      }
      const currentKeys = new Set(items.map((row) => row.key))
      knownKeys.forEach((key) => {
        if (currentKeys.has(key)) return
        knownKeys.delete(key)
        addedKeys.delete(key)
      })
      items
        .map((row) => row.key)
        .filter((key) => !knownKeys.has(key))
        .forEach((key) => {
          knownKeys.add(key)
          addedKeys.add(key)
        })
      return (index: number) => items[index]?.key ?? `removed:${index}`
    },
    get anchorTo() {
      return props.interaction.pinned() ? "end" : "start"
    },
    get followOnAppend() {
      return props.interaction.pinned()
    },
    scrollEndThreshold: 80,
    paddingStart: 40,
    get paddingEnd() {
      return props.interaction.composerHeight() + footerHeight() + 24
    },
    get scrollMargin() {
      return props.header ? 64 : 0
    },
    rangeExtractor: (range) =>
      timelineVirtualIndexes({ ...range, overscan: renderOverscan() }, [
        props.activeLastRowKey === undefined
          ? undefined
          : rows().findIndex((row) => row.key === props.activeLastRowKey),
        rows().findIndex((row) => row.key === focusedRowKey()),
      ]),
  })
  const storeCache = (key: string) => {
    if (key !== props.sessionKey) return
    cache.delete(key)
    cache.set(key, {
      version: 1,
      measurements: rows().flatMap((row) => {
        const size = measuredSizes.get(row.key)
        return size === undefined ? [] : [{ key: row.key, size }]
      }),
      disclosure: { ...disclosure },
    })
    while (cache.size > 16) cache.delete(cache.keys().next().value!)
  }
  const resizeItem = virtualizer.resizeItem
  virtualizer.resizeItem = (index, size) => {
    const current = virtualizer.measurementsCache[index]?.size
    resizeItem(index, size)
    const anchor = viewportAnchor
    if (anchor && !props.interaction.pinned()) queueMicrotask(() => restoreViewportAnchor(anchor))
    if (current === size || !viewport() || !props.interaction.pinned() || resizeAnchorScheduled) return
    resizeAnchorScheduled = true
    queueMicrotask(() => {
      resizeAnchorScheduled = false
      if (props.interaction.pinned()) virtualizer.scrollToEnd()
    })
  }
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    // ByMorning rows can remount from an estimate while markdown and disclosure geometry settle.
    // Compensate every row wholly above the fold before or after resize, not visible growth.
    const fold = (instance.scrollOffset ?? 0) + instance.scrollAdjustments + instance.options.scrollMargin
    return item.end <= fold || item.end + delta <= fold
  }

  const itemByKey = createMemo(() => new Map(virtualizer.getVirtualItems().map((item) => [String(item.key), item])))
  const virtualKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => String(item.key)))
  const commitElement = (element: HTMLDivElement) => {
    const key = element.parentElement?.dataset.timelineKey
    const previous = key === undefined ? undefined : measuredSizes.get(key)
    const size = timelineMeasuredSize(element.getBoundingClientRect().height, previous)
    if (key !== undefined) measuredSizes.set(key, size)
    virtualizer.resizeItem(Number(element.dataset.index), size)
  }
  const measureMountedRows = () => {
    if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame)
    measurementFrame = requestAnimationFrame(() => {
      const commit = () => viewport()?.querySelectorAll<HTMLDivElement>("[data-index]").forEach(commitElement)
      commit()
      measurementFrame = requestAnimationFrame(() => {
        measurementFrame = undefined
        commit()
        addedKeys.forEach((key) => {
          const element = viewport()?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(key)}"]`)
          if (element && !element.querySelector(pendingMarkdown)) addedKeys.delete(key)
        })
      })
    })
  }

  createEffect(
    on(
      rows,
      (next) => {
        const currentKeys = new Set(next.map((row) => row.key))
        measuredSizes.forEach((_size, key) => {
          if (!currentKeys.has(key)) measuredSizes.delete(key)
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    props.interaction.setScrollToEnd(() => {
      props.interaction.pin()
      virtualizer.scrollToEnd()
    })
  })
  createEffect(() => {
    props.interaction.setRevealMessage((id) => {
      const index = props.messageFirstRowIndex.get(id)
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: "center" })
    })
  })
  createEffect(
    on(
      () => props.sessionKey,
      (key) => {
        cacheSessionKey = key
        const nextEntry = cache.get(key)
        const next = nextEntry?.disclosure ?? {}
        Object.keys(disclosure).forEach((name) => setDisclosure(name, undefined))
        Object.entries(next).forEach(([name, open]) => setDisclosure(name, open))
        setFocusedRowKey(undefined)
        measuredSizes.clear()
        virtualizer.measure()
        timelineCachedMeasurements(rows(), nextEntry).forEach((measurement) => {
          measuredSizes.set(String(measurement.key), measurement.size)
          virtualizer.resizeItem(measurement.index, measurement.size)
        })
      },
      { defer: true },
    ),
  )
  const pendingMeasurements = () =>
    virtualizer.getVirtualItems().some((item) => !virtualizer.itemSizeCache.has(item.key))
  const settleColdBottom = () => {
    if (props.interaction.pinned()) virtualizer.scrollToEnd()
    if (virtualContent?.querySelector(pendingMarkdown) || pendingMeasurements()) {
      overscanFrame = requestAnimationFrame(settleColdBottom)
      return
    }
    overscanFrame = requestAnimationFrame(() => {
      if (props.interaction.pinned()) virtualizer.scrollToEnd()
      if (virtualContent?.querySelector(pendingMarkdown) || pendingMeasurements()) {
        settleColdBottom()
        return
      }
      overscanFrame = undefined
      const content = virtualContent
      if (!content) return
      content.removeAttribute("data-timeline-settling")
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        content.style.removeProperty("visibility")
        return
      }
      const clearAnimation = (event: AnimationEvent) => {
        if (event.target !== content) return
        content.removeEventListener("animationend", clearAnimation)
        content.removeEventListener("animationcancel", clearAnimation)
        content.removeAttribute("data-timeline-reveal")
      }
      content.addEventListener("animationend", clearAnimation)
      content.addEventListener("animationcancel", clearAnimation)
      content.setAttribute("data-timeline-reveal", "")
      content.style.removeProperty("visibility")
    })
  }
  onMount(() => {
    overscanFrame = requestAnimationFrame(() => {
      if (renderOverscan() < 20) setRenderOverscan(20)
      if (!coldBottomMount) {
        overscanFrame = undefined
        return
      }
      settleColdBottom()
    })
  })
  let footerObserver: ResizeObserver | undefined
  function VirtualRow(rowProps: { readonly rowKey: string }) {
    let element!: HTMLDivElement
    const initialItem = itemByKey().get(rowProps.rowKey)!
    const initialRow = rowByKey().get(rowProps.rowKey)!
    const item = createMemo(() => itemByKey().get(rowProps.rowKey) ?? initialItem)
    const row = createMemo(() => rowByKey().get(rowProps.rowKey) ?? rows()[item().index] ?? initialRow)
    const measureMountedElement = () => {
      queueMicrotask(() => {
        if (!element.isConnected) return
        virtualizer.measureElement(element)
        // The core can return a restored cached value on this synchronous path. Always replace
        // it with the mounted wrapper's actual geometry before the browser paints the row.
        commitElement(element)
      })
    }
    onMount(measureMountedElement)
    createEffect(on(() => item().index, measureMountedElement, { defer: true }))
    onCleanup(() => {
      queueMicrotask(() => virtualizer.measureElement(null))
    })

    return (
      <div
        data-timeline-key={rowProps.rowKey}
        style={{
          position: "absolute",
          top: `${item().start - (props.header ? 64 : 0)}px`,
          left: "0",
          width: "100%",
          overflow: "clip",
          "overflow-clip-margin": row().type === "turn-gap" ? undefined : "0.5px",
        }}
      >
        <div ref={(value) => (element = value)} data-index={item().index}>
          {props.renderRow(
            row,
            () => {
              // A disclosure can invalidate following dynamic measurements in the virtualizer
              // core, so commit every mounted row's actual size as one geometry update.
              measureMountedRows()
            },
            {
              value: (key) => disclosure[key],
              set: (key, open) => {
                setDisclosure(key, open)
                storeCache(cacheSessionKey)
              },
            },
          )}
        </div>
      </div>
    )
  }

  onCleanup(() => {
    storeCache(cacheSessionKey)
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    if (overscanFrame !== undefined) cancelAnimationFrame(overscanFrame)
    if (anchorFrame !== undefined) cancelAnimationFrame(anchorFrame)
    if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame)
    footerObserver?.disconnect()
    props.interaction.setViewportRef(undefined)
    props.interaction.setContentRef(undefined)
    props.interaction.setScrollToEnd(() => {})
    props.interaction.setRevealMessage(() => {})
  })

  return (
    <div data-component="timeline-virtualizer">
      <Show when={props.interaction.jump()}>
        <IconButton
          type="button"
          size="large"
          variant="neutral"
          data-slot="timeline-jump-latest"
          aria-label={i18n.t("ui.message.jumpToLatest")}
          onClick={props.interaction.resume}
          icon={<Icon name="chevron-down" />}
        />
      </Show>
      <ScrollView
        fill
        containOverscroll
        aria-label={i18n.t("ui.message")}
        style={{ "--sticky-accordion-top": props.header ? "48px" : "0px" }}
        viewportRef={(element) => {
          setViewport(element)
          props.interaction.setViewportRef(element)
        }}
        onWheel={(event) => {
          addedKeys.clear()
          props.interaction.onWheel(event)
        }}
        onTouchStart={props.interaction.onTouchStart}
        onTouchMove={(event) => {
          addedKeys.clear()
          props.interaction.onTouchMove(event)
        }}
        onPointerDown={(event) => {
          addedKeys.clear()
          props.interaction.onPointerDown(event)
        }}
        onScrollIntent={(direction) => {
          addedKeys.clear()
          props.interaction.onScrollIntent(direction)
        }}
        onKeyDown={props.interaction.onKeyDown}
        onScroll={(event) => {
          props.interaction.onScroll(event)
          rememberViewportAnchor()
          requestAnimationFrame(rememberViewportAnchor)
        }}
        onClick={props.interaction.onSelectionInteraction}
        onFocusIn={(event) => {
          const key =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-timeline-key]")?.dataset.timelineKey
              : undefined
          setFocusedRowKey(key)
        }}
        onFocusOut={() => {
          if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
          focusFrame = requestAnimationFrame(() => {
            focusFrame = undefined
            const root = viewport()
            const active = root?.ownerDocument.activeElement
            const key =
              active instanceof Element && root?.contains(active)
                ? active.closest<HTMLElement>("[data-timeline-key]")?.dataset.timelineKey
                : undefined
            setFocusedRowKey(key)
          })
        }}
      >
        {props.header}
        <div
          data-timeline-virtual-content
          ref={(element) => {
            virtualContent = element
            props.interaction.setContentRef(element)
          }}
          data-cold-bottom={coldBottomMount ? "" : undefined}
          data-timeline-settling={coldBottomMount ? "" : undefined}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
            visibility: coldBottomMount ? "hidden" : undefined,
          }}
        >
          <TimelineOlderError
            error={props.interaction.olderError()}
            loading={props.interaction.loading()}
            retry={props.interaction.loadOlder}
          />
          <Show when={rows().length === 0}>
            <p data-slot="message-timeline-empty">{i18n.t("ui.message.empty")}</p>
          </Show>
          <For each={virtualKeys()}>{(rowKey) => <VirtualRow rowKey={rowKey} />}</For>
          <Show when={props.footer !== undefined}>
            <div
              data-slot="timeline-bottom-footer"
              ref={(element) => {
                const update = () => {
                  const height = timelineMeasuredSize(element.getBoundingClientRect().height, footerHeight())
                  if (height === footerHeight()) return
                  setFooterHeight(height)
                  virtualizer.measure()
                  if (props.interaction.pinned()) queueMicrotask(() => virtualizer.scrollToEnd())
                }
                footerObserver = new ResizeObserver(update)
                footerObserver.observe(element)
                update()
              }}
              style={{
                position: "absolute",
                top: `${virtualizer.getTotalSize() - props.interaction.composerHeight() - footerHeight() - 24}px`,
                left: "0",
              }}
            >
              {props.footer}
            </div>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}

export const timelineVirtualizerCacheSize = () => cache.size

export const timelineVirtualizerSeedLegacyCache = (sessionKey: string, measurements: VirtualItem[]) =>
  cache.set(sessionKey, { measurements, disclosure: {} })
