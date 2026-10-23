import type { ModelListOutput, ModelUpdateInput } from "@bymorning/client"
import { Show, type JSX } from "solid-js"

import { Field } from "../../ui/components/field"
import { Select } from "../../ui/components/select"
import { TextInput } from "../../ui/components/text-input"
import { createForm, FormDialog, FormFrame } from "../../ui/form"
import "./custom-dialog.css"

/** A Provider a custom Model can be added to. */
export interface CustomProvider {
  readonly id: ModelUpdateInput["provider"]
  readonly name: string
}

/** The custom Model configuration a dialog submits; `id` is omitted to default it to the upstream name. */
export type CustomModel = Omit<ModelUpdateInput, "workspace" | "id"> & { readonly id?: string }

const price = (label: string, value: string) => {
  if (value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? undefined : `${label} must be a non-negative number.`
}

const optionalNumber = (value: string) => (value.trim() === "" ? undefined : Number(value))

/**
 * Add or edit a Workspace custom Model: a display label and the upstream model
 * name on an existing Provider, with optional prices and context limit. A key
 * is chosen only when adding, because it is the Model's identity.
 */
export function CustomModelDialog(props: {
  readonly providers: ReadonlyArray<CustomProvider>
  /** The custom Model being edited; absent when adding. */
  readonly model?: ModelListOutput[number]
  readonly save: (input: CustomModel) => Promise<unknown>
}): JSX.Element {
  const editing = () => props.model !== undefined
  const info = props.model?.info
  const form = createForm({
    values: {
      provider: props.providers.find((provider) => provider.id === info?.provider) ?? props.providers[0],
      name: info?.name ?? "",
      apiID: info?.apiID ?? "",
      id: "",
      input: info?.cost.input === undefined ? "" : String(info.cost.input),
      output: info?.cost.output === undefined ? "" : String(info.cost.output),
      context: info?.limit.context === undefined ? "" : String(info.limit.context),
    },
    validate: (values) => {
      if (!values.provider) return "Choose a provider."
      if (!values.name.trim()) return "Enter a display label."
      if (!values.apiID.trim()) return "Enter the upstream model name."
      if (values.id.includes("/") || /\s/.test(values.id.trim())) return "The key cannot contain slashes or spaces."
      const context = values.context.trim()
      if (context !== "" && !(Number.isInteger(Number(context)) && Number(context) > 0))
        return "Context limit must be a whole number of tokens."
      return price("Input price", values.input) ?? price("Output price", values.output)
    },
    submit: (values) => {
      const input = optionalNumber(values.input)
      const output = optionalNumber(values.output)
      const context = optionalNumber(values.context)
      return props.save({
        provider: values.provider!.id,
        ...(editing() ? { id: info!.id } : values.id.trim() === "" ? {} : { id: values.id.trim() }),
        name: values.name.trim(),
        apiID: values.apiID.trim(),
        ...(input === undefined && output === undefined
          ? {}
          : { cost: { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) } }),
        ...(context === undefined ? {} : { limit: { context } }),
      })
    },
    fallback: "The model could not be saved.",
  })
  return (
    <FormDialog
      form={form}
      title={editing() ? "Edit custom model" : "Add custom model"}
      description="Offer a model the provider serves under its upstream name. Prices and the context limit stay unknown unless you enter them."
      actions={
        <FormFrame.Actions
          submitLabel={editing() ? "Save changes" : "Add model"}
          pendingLabel={editing() ? "Saving…" : "Adding…"}
          disabled={!form.values.provider || !form.values.name.trim() || !form.values.apiID.trim()}
        />
      }
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>Provider</Field.Label>
          <Select
            aria-label="Provider"
            appearance="full-width"
            options={[...props.providers]}
            current={form.values.provider}
            disabled={form.pending || editing()}
            value={(provider) => provider.id}
            label={(provider) => provider.name}
            onSelect={(provider) => provider && form.set("provider", provider)}
          />
        </Field>
        <Field>
          <Field.Label>Display label</Field.Label>
          <TextInput
            autofocus
            required
            appearance="full-width"
            placeholder="Team Sonnet"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
        </Field>
        <Field>
          <Field.Label>Upstream model name</Field.Label>
          <TextInput
            required
            appearance="full-width"
            placeholder="Inference profile ID or model name"
            spellcheck={false}
            value={form.values.apiID}
            disabled={form.pending}
            onInput={(event) => form.set("apiID", event.currentTarget.value)}
          />
        </Field>
        <Show when={!editing()}>
          <div data-slot="custom-model-field">
            <Field>
              <Field.Label>Key (optional)</Field.Label>
              <TextInput
                appearance="full-width"
                placeholder="Defaults to the upstream model name"
                spellcheck={false}
                aria-describedby="custom-model-key-hint"
                value={form.values.id}
                disabled={form.pending}
                onInput={(event) => form.set("id", event.currentTarget.value)}
              />
            </Field>
            <p id="custom-model-key-hint" data-slot="custom-model-hint">
              The model's identity within the provider and in API requests. It can't be changed later.
            </p>
          </div>
        </Show>
        <div data-slot="custom-model-numbers">
          <Field>
            <Field.Label>Input price</Field.Label>
            <TextInput
              inputmode="decimal"
              appearance="full-width"
              placeholder="Unknown"
              aria-describedby="custom-model-price-hint"
              value={form.values.input}
              disabled={form.pending}
              onInput={(event) => form.set("input", event.currentTarget.value)}
            />
          </Field>
          <Field>
            <Field.Label>Output price</Field.Label>
            <TextInput
              inputmode="decimal"
              appearance="full-width"
              placeholder="Unknown"
              aria-describedby="custom-model-price-hint"
              value={form.values.output}
              disabled={form.pending}
              onInput={(event) => form.set("output", event.currentTarget.value)}
            />
          </Field>
          <Field>
            <Field.Label>Context limit</Field.Label>
            <TextInput
              inputmode="numeric"
              appearance="full-width"
              placeholder="Unknown"
              aria-describedby="custom-model-context-hint"
              value={form.values.context}
              disabled={form.pending}
              onInput={(event) => form.set("context", event.currentTarget.value)}
            />
          </Field>
        </div>
        <p id="custom-model-price-hint" data-slot="custom-model-hint">
          Prices are USD per million tokens. Without them, usage is recorded at no cost.
        </p>
        <p id="custom-model-context-hint" data-slot="custom-model-hint">
          Tokens. Without a limit, conversations on this model are not compacted automatically.
        </p>
      </FormFrame.Fields>
    </FormDialog>
  )
}
