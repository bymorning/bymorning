/* @refresh reload */
import "solid-devtools"
import "./main.css"

import { render } from "solid-js/web"

import App from "./app"

const root = document.getElementById("root")

if (!(root instanceof HTMLElement)) {
  throw new Error("Application root element not found")
}

render(() => <App />, root)
document.getElementById("boot-status")?.remove()
