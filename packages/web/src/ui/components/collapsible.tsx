import { Collapsible as Kobalte, type CollapsibleRootProps } from "@kobalte/core/collapsible"
import { splitProps, type ComponentProps, type JSX, type ParentProps } from "solid-js"

import { Icon } from "./icon"
import "./collapsible.css"

export interface CollapsibleProps extends ParentProps<CollapsibleRootProps> {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  variant?: "normal" | "ghost"
}

function CollapsibleRoot(props: CollapsibleProps) {
  const [local, rest] = splitProps(props, ["class", "classList", "variant"])
  return (
    <Kobalte
      {...rest}
      data-component="collapsible"
      data-variant={local.variant ?? "normal"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function CollapsibleTrigger(props: ComponentProps<typeof Kobalte.Trigger>) {
  return <Kobalte.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props: ComponentProps<typeof Kobalte.Content>) {
  return <Kobalte.Content data-slot="collapsible-content" {...props} />
}

function CollapsibleArrow(props: ComponentProps<"div"> & { icon?: JSX.Element } = {}) {
  const [local, rest] = splitProps(props, ["icon"])
  return (
    <div data-slot="collapsible-arrow" {...rest}>
      <span data-slot="collapsible-arrow-icon">
        {local.icon ?? <Icon name="chevron-down" size="small" />}
      </span>
    </div>
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
