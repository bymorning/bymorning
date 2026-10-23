// -1 means no selection; -1 is also returned for an empty list since there is nothing to select.
export const nextIndex = (count: number, current: number, delta: 1 | -1) =>
  count === 0 ? -1 : ((current === -1 ? 0 : current) + delta + count) % count
