import { For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { Accordion } from "@bymorning/ui/accordion"
import { ActionMenu } from "@bymorning/ui/action-menu"
import { Avatar } from "@bymorning/ui/avatar"
import { Button } from "@bymorning/ui/button"
import { Checkbox } from "@bymorning/ui/checkbox"
import { Collapsible } from "@bymorning/ui/collapsible"
import { ConfirmDialog } from "@bymorning/ui/confirm-dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@bymorning/ui/dialog"
import { DropdownMenu } from "@bymorning/ui/dropdown-menu"
import { Field } from "@bymorning/ui/field"
import { FileIcon } from "@bymorning/ui/file-icon"
import { FileTree } from "@bymorning/ui/file-tree"
import { Icon } from "@bymorning/ui/icon"
import { IconButton } from "@bymorning/ui/icon-button"
import { Keybind } from "@bymorning/ui/keybind"
import { Loader } from "@bymorning/ui/loader"
import { MaterialPicker } from "@bymorning/ui/material-picker"
import { Menu } from "@bymorning/ui/menu"
import { ProgressCircle } from "@bymorning/ui/progress-circle"
import { ProjectAvatar } from "@bymorning/ui/project-avatar"
import { RadioGroup, RadioItem } from "@bymorning/ui/radio"
import { ResizeHandle } from "@bymorning/ui/resize-handle"
import { ScrollView } from "@bymorning/ui/scroll-view"
import { SearchSelect } from "@bymorning/ui/search-select"
import { SegmentedControl } from "@bymorning/ui/segmented-control"
import { Select } from "@bymorning/ui/select"
import { Spinner } from "@bymorning/ui/spinner"
import { Switch } from "@bymorning/ui/switch"
import { Tag } from "@bymorning/ui/tag"
import { TextInput } from "@bymorning/ui/text-input"
import { TextShimmer } from "@bymorning/ui/text-shimmer"
import { Textarea } from "@bymorning/ui/textarea"
import { Toast, showToast, toaster } from "@bymorning/ui/toast"
import { Tooltip } from "@bymorning/ui/tooltip"
import { ThemeProvider, useTheme, type Theme } from "@bymorning/ui/theme"
import { DialogProvider, useDialog } from "@bymorning/ui/context/dialog"
import { I18nProvider, createI18n } from "@bymorning/ui/context/i18n"
import "@bymorning/ui/styles.css"
import "./fixture.css"

const choices = ["Alpha", "Beta", "Gamma"]

function ThemeControl() {
  const theme = useTheme()
  return (
    <div class="row">
      <label>
        Theme{" "}
        <select aria-label="Theme" value={theme.theme()} onChange={(e) => theme.setTheme(e.currentTarget.value)}>
          <For each={theme.list()}>{(id) => <option value={id}>{theme.name(id)}</option>}</For>
        </select>
      </label>
      <label>
        Scheme{" "}
        <select
          aria-label="Scheme"
          value={theme.scheme()}
          onChange={(e) => theme.setScheme(e.currentTarget.value as Theme.Scheme)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
      <output aria-label="Theme state">
        {theme.theme()}:{theme.scheme()}:{theme.mode()}
      </output>
    </div>
  )
}

function OverlayContent(props: { level: number }) {
  const dialog = useDialog()
  const [state, setState] = createStore({ current: "Alpha", action: "" })
  return (
    <Dialog aria-label={`Dialog ${props.level}`}>
      <DialogHeader>
        <DialogTitle>Dialog {props.level}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <TextInput aria-label="Dialog text" autofocus />
        <div class="row">
          <Select
            options={choices}
            current={state.current}
            onSelect={(next) => setState("current", next ?? "Alpha")}
            aria-label="Dialog choice"
          />
          <ActionMenu label="Dialog row">
            <ActionMenu.Item onSelect={() => setState("action", "Edited")}>Edit row</ActionMenu.Item>
          </ActionMenu>
          <Tooltip value="Dialog help">
            <span>Help</span>
          </Tooltip>
          <Button onClick={() => dialog.push(() => <OverlayContent level={props.level + 1} />)}>Push dialog</Button>
        </div>
        <output>{state.action}</output>
      </DialogBody>
      <DialogFooter>
        <Button onClick={dialog.close}>Close dialog</Button>
      </DialogFooter>
    </Dialog>
  )
}

function Gallery() {
  const dialog = useDialog()
  const [state, setState] = createStore({
    text: "",
    notes: "",
    checked: false,
    enabled: false,
    radio: "one",
    segment: "one" as string | null,
    choice: "Alpha",
    material: "Alpha",
    searchOpen: false,
    selected: "alpha",
    path: "",
    width: 300,
    menu: "",
    confirmed: false,
  })
  onCleanup(() => toaster.dismiss())
  return (
    <main>
      <h1>ByMorning UI</h1>
      <ThemeControl />
      <section aria-label="Controls">
        <h2>Controls</h2>
        <div class="row">
          <Button variant="primary">Primary action</Button>
          <Button>Neutral</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline">Outline</Button>
          <Button disabled>Disabled</Button>
          <Button variant="loading">Loading</Button>
          <IconButton aria-label="Icon action" icon={<Icon name="plus" />} />
        </div>
        <div class="column">
          <Field>
            <Field.Label>Account name</Field.Label>
            <Field.Control>
              <TextInput value={state.text} onInput={(e) => setState("text", e.currentTarget.value)} />
            </Field.Control>
            <Field.Suffix>Public display name</Field.Suffix>
          </Field>
          <Textarea aria-label="Notes" value={state.notes} onInput={(e) => setState("notes", e.currentTarget.value)} />
          <Checkbox label="Accept terms" checked={state.checked} onChange={(value) => setState("checked", value)} />
          <Switch checked={state.enabled} onChange={(value) => setState("enabled", value)}>
            Enable alerts
          </Switch>
          <RadioGroup label="Delivery" value={state.radio} onChange={(value) => setState("radio", value)}>
            <RadioItem value="one" label="Email" />
            <RadioItem value="two" label="Push" />
          </RadioGroup>
          <SegmentedControl value={state.segment} onChange={(value) => setState("segment", value)} aria-label="View">
            <SegmentedControl.Item value="one">Grid</SegmentedControl.Item>
            <SegmentedControl.Item value="two">List</SegmentedControl.Item>
          </SegmentedControl>
        </div>
        <output aria-label="Control state">
          {state.text}|{state.checked ? "checked" : "unchecked"}|{state.radio}|{state.segment}
        </output>
      </section>
      <section aria-label="Selection">
        <h2>Selection and menus</h2>
        <div class="row">
          <Select
            options={choices}
            current={state.choice}
            onSelect={(next) => setState("choice", next ?? "Alpha")}
            aria-label="Choice"
          />
          <SearchSelect
            model={{
              options: () => choices.map((label) => ({ key: label.toLowerCase(), label })),
              current: () => state.selected,
              pending: () => false,
              select: (key) => setState("selected", key),
            }}
            trigger={(props) => <Button {...props}>Search selection</Button>}
            open={state.searchOpen}
            onOpenChange={(open) => setState("searchOpen", open)}
            label="Option"
          />
          <MaterialPicker
            items={choices}
            key={(item) => item}
            label={(item) => item}
            selected={state.material}
            searchLabel="Search materials"
            emptyLabel="No materials"
            triggerLabel="Material"
            trigger={<span>{state.material}</span>}
            leading={() => <Icon name="plus" />}
            onSelect={(item) => setState("material", item)}
          />
          <Menu>
            <Menu.Trigger>Menu</Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item onSelect={() => setState("menu", "Copied")}>Copy item</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
          <DropdownMenu>
            <DropdownMenu.Trigger>Dropdown</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <DropdownMenu.Item onSelect={() => setState("menu", "Archived")}>Archive item</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
        <output aria-label="Selection state">
          {state.choice}|{state.selected}|{state.material}|{state.menu}
        </output>
      </section>
      <section aria-label="Disclosure">
        <h2>Disclosure</h2>
        <Accordion>
          <Accordion.Item value="details">
            <Accordion.Header>
              <Accordion.Trigger>Accordion details</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>Accordion content</Accordion.Content>
          </Accordion.Item>
        </Accordion>
        <Collapsible>
          <Collapsible.Trigger>Collapsible details</Collapsible.Trigger>
          <Collapsible.Content>Collapsible content</Collapsible.Content>
        </Collapsible>
      </section>
      <section aria-label="Overlays">
        <h2>Overlays</h2>
        <div class="row">
          <Button onClick={() => dialog.show(() => <OverlayContent level={1} />)}>Open dialog</Button>
          <Button
            onClick={() =>
              dialog.show(() => (
                <ConfirmDialog
                  title="Confirm action"
                  onConfirm={() => {
                    setState("confirmed", true)
                  }}
                />
              ))
            }
          >
            Open confirmation
          </Button>
          <Button
            onClick={() => showToast({ title: "Saved", description: "The action completed", variant: "success" })}
          >
            Show toast
          </Button>
          <Tooltip value="More information">
            <Button>Tooltip target</Button>
          </Tooltip>
        </div>
        <output>{state.confirmed ? "Confirmed" : "Waiting"}</output>
      </section>
      <section aria-label="Visuals">
        <h2>Visuals</h2>
        <div class="row">
          <Avatar fallback="ByMorning" />
          <ProjectAvatar fallback="Project" />
          <FileIcon node={{ path: "src/index.ts", type: "file" }} />
          <Tag>Label</Tag>
          <Keybind keys={["Ctrl", "K"]} />
          <Loader />
          <Spinner />
          <ProgressCircle percentage={60} />
          <TextShimmer text="Working" />
        </div>
      </section>
      <section aria-label="Files and scrolling">
        <h2>Files and scrolling</h2>
        <FileTree
          paths={["README.md", "src/index.ts", "src/button.tsx"]}
          activePath={state.path}
          onSelect={(path) => setState("path", path)}
        />
        <output aria-label="Selected file">{state.path}</output>
        <ScrollView class="scroll-fixture" data-testid="scroll" tabindex={0}>
          <For each={Array.from({ length: 40 }, (_, i) => i)}>{(i) => <p>Scroll row {i}</p>}</For>
        </ScrollView>
        <div class="resize-fixture" style={{ width: `${state.width}px` }}>
          <ResizeHandle
            direction="horizontal"
            size={state.width}
            min={150}
            max={600}
            onResize={(width) => setState("width", width)}
          />
        </div>
      </section>
    </main>
  )
}

function Fixture() {
  const [state, setState] = createStore({ mounted: true })
  return (
    <>
      <button data-testid="mount" onClick={() => setState("mounted", !state.mounted)}>
        {state.mounted ? "Unmount gallery" : "Mount gallery"}
      </button>
      <Show when={state.mounted}>
        <ThemeProvider>
          <I18nProvider value={createI18n()}>
            <DialogProvider>
              <Gallery />
              <Toast.Region />
            </DialogProvider>
          </I18nProvider>
        </ThemeProvider>
      </Show>
    </>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
