import { Control, ErrorMessage, Indicator, Input, Label, Root } from "@kobalte/core/checkbox"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import "./checkbox.css"

export interface CheckboxProps extends ComponentProps<typeof Root> {
  label: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, ["class", "classList", "label", "description", "hideLabel"])
  return (
    <Root
      {...others}
      data-component="checkbox"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="checkbox-row">
        <Input data-slot="checkbox-input" />
        <div data-slot="checkbox-control-stack">
          <Control data-slot="checkbox-control">
            <Indicator data-slot="checkbox-indicator">
              <svg
                data-slot="checkbox-check-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25" stroke="#FAFAFA" stroke-width="1" />
              </svg>
              <svg
                data-slot="checkbox-minus-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M12.75 8H3.25" stroke="#FAFAFA" stroke-linejoin="round" stroke-width="1" />
              </svg>
            </Indicator>
          </Control>
        </div>
        <Label data-slot="checkbox-label" classList={{ "sr-only": local.hideLabel }}>
          <div data-slot="checkbox-text">
            <span data-slot="checkbox-label-text">{local.label}</span>
            <Show when={local.description}>
              {(description) => <span data-slot="checkbox-description">{description()}</span>}
            </Show>
          </div>
        </Label>
      </div>
      <ErrorMessage data-slot="checkbox-error" />
    </Root>
  )
}
