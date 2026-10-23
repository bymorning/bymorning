import { createUniqueId, splitProps, type ComponentProps } from "solid-js"
import "./spinner.css"

export function Spinner(props: {
  label?: string
  size?: number
  class?: string
  classList?: ComponentProps<"svg">["classList"]
  style?: ComponentProps<"svg">["style"]
}) {
  const [local, rest] = splitProps(props, ["label", "size", "class", "classList"])
  const clipID = createUniqueId()
  const size = () => local.size ?? 18
  const pane = (step: number) => ({
    animation: "spinner-glass 1s ease-in-out infinite",
    "animation-delay": `${step * -0.2}s`,
  })
  return (
    <svg
      {...rest}
      viewBox="0 0 204 231"
      data-component="spinner"
      width={size()}
      height={(size() * 231) / 204}
      role={local.label ? "status" : undefined}
      aria-label={local.label}
      aria-hidden={local.label ? undefined : "true"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={clipID}>
          <path d="M101.75,5.5h0C48.59,5.5,5.5,48.59,5.5,101.75v27.5c0,53.16,43.09,96.25,96.25,96.25h0c53.16,0,96.25-43.09,96.25-96.25v-27.5c0-53.16-43.09-96.25-96.25-96.25Z" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clipID})`}>
        <rect x="0" y="0" width="210" height="54.39" fill="#ffe457" style={pane(0)} />
        <polygon points="0,54.39 90,54.37 37.75,127.71 0,127.71" fill="#ee3726" style={pane(1)} />
        <polygon points="90,54.37 210,54.39 210,127.71 37.75,127.71" fill="#ff9c36" style={pane(4)} />
        <polygon points="0,127.71 90,127.71 46.91,208.38 0,230" fill="#22afff" style={pane(2)} />
        <polygon points="90,127.71 210,127.71 210,230 0,230 46.91,208.38" fill="#4ec722" style={pane(3)} />
      </g>
    </svg>
  )
}
