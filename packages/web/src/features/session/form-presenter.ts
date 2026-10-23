import { formNavigation } from "./form-navigation"
import type { FormItem, FormViewModel } from "./ui/form-model"

/** Field keys the external-server wizard collapses into its settings disclosure. */
const EXTERNAL_SERVER_ADVANCED_KEYS = ["auth", "clientID", "scope", "codemode"]
const EXTERNAL_SERVER_SETTINGS_LABEL = "Authentication and Code Mode"

/** Project a server-owned Form into the shared session/caller presentation. */
export function projectFormItem(item: FormItem): FormViewModel {
  const metadata = item.metadata
  const externalServer = metadata?.kind === "external-server-creator"
  const urlElicitation =
    metadata?.mode === "url" && (metadata.kind === "tool-elicitation" || metadata.kind === "mcp-elicitation")
  const navigation = formNavigation(item)
  const stage = externalServer ? metadata?.stage : undefined
  const fields =
    navigation === undefined ? item.fields : item.fields.filter((field) => field.key !== navigation.actionKey)
  const orderedFields = urlElicitation
    ? [...fields.filter((field) => field.type === "external"), ...fields.filter((field) => field.type !== "external")]
    : fields
  const external = urlElicitation ? fields.find((field) => field.type === "external") : undefined
  const action = urlElicitation
    ? fields.find((field) => field.type === "string" && field.options?.some((option) => option.value === "accept"))
    : undefined
  const authorization =
    external?.type === "external" && action?.type === "string"
      ? { url: external.url, externalKey: external.key, actionKey: action.key, acceptValue: "accept" }
      : undefined

  return {
    id: item.id,
    title: item.title,
    fields: item.fields,
    sections:
      stage === "mcp"
        ? [
            { fields: fields.filter((field) => field.key === "url") },
            {
              fields: fields.filter((field) => EXTERNAL_SERVER_ADVANCED_KEYS.includes(field.key)),
              collapsedLabel: EXTERNAL_SERVER_SETTINGS_LABEL,
            },
          ]
        : [{ fields: orderedFields }],
    choicePresentation:
      metadata?.choicePresentation === "search"
        ? "search"
        : metadata?.choicePresentation === "cards" || externalServer || urlElicitation
          ? "cards"
          : "select",
    ...(authorization === undefined ? {} : { authorization }),
    ...(stage === "openapi" ? { projectPathField: "documentPath" } : {}),
    canGoBack: navigation !== undefined && metadata?.canGoBack === true,
    ...(metadata?.kind === "question" ? { answerRequired: true } : {}),
    submitLabel:
      navigation !== undefined && typeof metadata?.nextLabel === "string"
        ? metadata.nextLabel
        : urlElicitation
          ? "Send response"
          : "Submit",
  }
}
