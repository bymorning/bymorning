import type { JSX } from "solid-js"

import { Spinner } from "../ui/components/spinner"
import { useI18n } from "../ui/context/i18n"
import "./loading.css"

/** Named pending state while the session route chunk or session record is loading. */
export function SessionLoading(): JSX.Element {
  const i18n = useI18n()
  return (
    <div data-slot="session-loading" role="status" aria-label={i18n.t("ui.session.loading")}>
      <Spinner size={32} />
      <span>{i18n.t("ui.session.loading")}</span>
    </div>
  )
}
