/**
 * Give focus back to the composer after an async settle (a stop, a model save, a post-navigation
 * autofocus) without stealing it: only act when nothing holds focus or focus is still inside the
 * composer, so a user who moved on elsewhere is left alone.
 */
export function reclaimFocus(focus: () => void): void {
  const active = document.activeElement
  if (active === null || active === document.body || active.closest('[data-component="session-composer"]') !== null)
    focus()
}

/**
 * Focus the composer shortly after arriving by navigation. Chrome drops programmatic focus fired
 * while the triggering click is still dispatching, and a closing dialog may hand focus elsewhere in
 * the meantime, so the focus is deferred and wins over that settling. Any user pointer or key
 * input before it fires means the user already chose where to be, so it is skipped. Returns a canceller.
 */
export function autofocus(focus: () => void, delay: number): () => void {
  let moved = false
  const mark = () => {
    moved = true
  }
  const events = ["pointerdown", "keydown"] as const
  for (const name of events) document.addEventListener(name, mark, true)
  const done = () => {
    for (const name of events) document.removeEventListener(name, mark, true)
  }
  const timer = setTimeout(() => {
    done()
    if (!moved) focus()
  }, delay)
  return () => {
    clearTimeout(timer)
    done()
  }
}
