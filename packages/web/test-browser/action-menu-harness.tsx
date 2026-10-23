import { Dialog as KobalteDialog } from "@kobalte/core/dialog"
import { For, createSignal } from "solid-js"
import { render } from "solid-js/web"
import "../src/main.css"

import { ActionMenu } from "../src/ui/components/action-menu"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "../src/ui/components/dialog"
import { OverlayHost } from "../src/ui/components/overlay-host"

function Actions(props: { readonly label: string }) {
  return (
    <ActionMenu label={props.label}>
      <ActionMenu.Item disabled>Unavailable</ActionMenu.Item>
      <ActionMenu.Item>Edit</ActionMenu.Item>
      <ActionMenu.Item>Remove</ActionMenu.Item>
    </ActionMenu>
  )
}

function DialogLayer(props: { readonly layer: number }) {
  return (
    <KobalteDialog open modal={props.layer === 3}>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay data-component="dialog-overlay" style={{ "z-index": String(40 + props.layer * 10) }} />
        <div data-dialog-layer={props.layer} style={{ position: "fixed", inset: "0", "z-index": 40 + props.layer * 10 }}>
          <Dialog aria-label={`Dialog ${props.layer}`}>
            <DialogHeader><DialogTitle>Dialog {props.layer}</DialogTitle></DialogHeader>
            <DialogBody><div style={{ padding: "16px" }}><Actions label={`Dialog ${props.layer}`} /></div></DialogBody>
          </Dialog>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  )
}

function Fixture() {
  const [dialogs, setDialogs] = createSignal(0)
  return (
    <OverlayHost>
      <main style={{ padding: "32px", height: "1200px", background: "var(--color-bg-base)" }}>
        <h1>Action menu overlay fixture</h1>
        <Actions label="Page" />
        <button onClick={() => setDialogs((count) => Math.min(3, count + 1))}>Push dialog</button>
        <div data-testid="overflow" style={{ width: "360px", height: "220px", overflow: "auto", margin: "32px 0" }}>
          <table style={{ width: "900px", height: "600px" }}><tbody><tr><td>Overflow action</td><td><Actions label="Overflow row" /></td></tr></tbody></table>
        </div>
      </main>
      <For each={Array.from({ length: dialogs() }, (_, index) => index + 1)}>{(layer) => <DialogLayer layer={layer} />}</For>
    </OverlayHost>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
