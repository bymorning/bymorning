import {
  Description,
  ErrorMessage,
  Item,
  ItemControl,
  ItemIndicator,
  ItemInput,
  ItemLabel,
  Label,
  Root,
} from "@kobalte/core/radio-group"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import "./radio.css"

export interface RadioGroupProps extends ParentProps<ComponentProps<typeof Root>> {
  label?: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioGroup(props: RadioGroupProps) {
  const [local, others] = splitProps(props, ["class", "classList", "children", "label", "description", "hideLabel"])
  return (
    <Root
      {...others}
      data-component="radio"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.label}>
        {(label) => (
          <Label data-slot="radio-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        {(description) => <Description data-slot="radio-description">{description()}</Description>}
      </Show>
      <div data-slot="radio-items">{local.children}</div>
      <ErrorMessage data-slot="radio-error" />
    </Root>
  )
}

export interface RadioItemProps extends ComponentProps<typeof Item> {
  label: JSX.Element
  description?: JSX.Element
  hideLabel?: boolean
}

export function RadioItem(props: RadioItemProps) {
  const [local, others] = splitProps(props, ["class", "classList", "label", "description", "hideLabel"])
  return (
    <Item
      {...others}
      data-slot="radio-item"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <ItemInput data-slot="radio-item-input" />
      <div data-slot="radio-item-control-stack">
        <ItemControl data-slot="radio-item-control">
          <ItemIndicator data-slot="radio-item-indicator" />
        </ItemControl>
      </div>
      <ItemLabel data-slot="radio-item-label" classList={{ "sr-only": local.hideLabel }}>
        <div data-slot="radio-item-text">
          <span data-slot="radio-item-label-text">{local.label}</span>
          <Show when={local.description}>
            {(description) => <span data-slot="radio-item-description">{description()}</span>}
          </Show>
        </div>
      </ItemLabel>
    </Item>
  )
}
