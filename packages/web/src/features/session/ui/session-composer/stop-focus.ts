import type { ComposerContext } from "./context"
import { reclaimFocus } from "./reclaim-focus"

/** Stop replaces the focused button with Send, so hand focus back to the editor once it is editable again. */
export function stopAndFocus(composer: Pick<ComposerContext, "stop" | "restoreFocus">): void {
  composer.restoreFocus()
  const reclaim = () => reclaimFocus(composer.restoreFocus)
  // A failed stop is reported by the composer's own error state; it must not escape as unhandled.
  void new Promise<unknown>((resolve) => resolve(composer.stop())).catch(() => undefined).finally(reclaim)
}
