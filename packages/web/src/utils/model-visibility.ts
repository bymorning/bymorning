import { DateTime } from "luxon"
import { createMemo } from "solid-js"
import { useOptionalSettings } from "../context/settings"
import { modelOptionKey, type ModelOption } from "./model-option"

/** OpenCode web recency semantics: casual 30-day months, stable ties, and no undefined family group. */
export function latestModels(models: ReadonlyArray<ModelOption>, now: number): ReadonlySet<string> {
  const groups = new Map<string, ModelOption>()
  for (const model of models) {
    const date = DateTime.fromISO(model.releaseDate ?? "")
    if (!(Math.abs(date.diff(DateTime.fromMillis(now)).as("months")) < 6) || model.family === undefined) continue
    const group = JSON.stringify([model.provider, model.family])
    const previous = groups.get(group)
    if (!previous || (model.releaseDate ?? "") > (previous.releaseDate ?? "")) groups.set(group, model)
  }
  return new Set(Array.from(groups.values(), modelOptionKey))
}

/** Share browser preferences and picker projection across existing sessions, drafts, and management. */
export function createVisibility(models: () => ReadonlyArray<ModelOption>) {
  const settings = useOptionalSettings()
  const latest = createMemo(() => latestModels(models(), Date.now()))
  const visible = (model: ModelOption) => {
    const preference = settings?.picker.get(modelOptionKey(model))
    if (preference === "hide") return false
    if (preference === "show") return true
    if (latest().has(modelOptionKey(model))) return true
    return !DateTime.fromISO(model.releaseDate ?? "").isValid
  }
  return {
    visible,
    set: (model: ModelOption, show: boolean) => settings?.picker.set(modelOptionKey(model), show ? "show" : "hide"),
    option: (model: ModelOption) => ({
      key: modelOptionKey(model),
      label: model.name.replace("(latest)", "").trim(),
      group: model.providerLabel,
      ...(visible(model) ? {} : { hidden: true }),
      ...(model.name.includes("(latest)") ? { latest: true } : {}),
    }),
  }
}
