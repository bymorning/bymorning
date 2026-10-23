import { Root } from "@kobalte/core/button"
import { type ComponentProps, type JSX, splitProps } from "solid-js"
import "./icon-button.css"

export interface IconButtonProps
  extends ComponentProps<typeof Root>, Pick<ComponentProps<"button">, "class" | "classList"> {
  // temporary
  icon?: JSX.Element
  // icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  // iconSize?: IconProps["size"]
  variant?: "neutral" | "primary" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "state"])
  return (
    <Root
      {...rest}
      data-component="icon-button"
      // data-icon={props.icon}
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-state={split.state}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.icon}
      {/*<Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />*/}
    </Root>
  )
}
