import { type ComponentProps, splitProps } from "solid-js"
import "./textarea.css"

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Error styling for the field and value text. */
  invalid?: boolean
  appearance?: "base" | "diagnostic" | "full-width"
}

export function Textarea(props: TextareaProps) {
  const [local, textareaProps] = splitProps(props, ["class", "classList", "invalid", "appearance", "disabled", "rows"])

  return (
    <div
      data-component="textarea"
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      data-appearance={local.appearance ?? "base"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <textarea
        {...textareaProps}
        rows={local.rows ?? 3}
        disabled={local.disabled}
        aria-invalid={local.invalid ? true : undefined}
        data-slot="textarea-textarea"
      />
    </div>
  )
}
