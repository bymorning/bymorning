# @bymorning/ui

Private Solid design system extracted from Web.

## Use

```tsx
import { Button } from "@bymorning/ui/button"
import { DialogProvider } from "@bymorning/ui/context/dialog"
import { I18nProvider, createI18n } from "@bymorning/ui/context/i18n"
import { ThemeProvider } from "@bymorning/ui/theme"
import { Toast } from "@bymorning/ui/toast"
import "@bymorning/ui/styles.css"

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider value={createI18n()}>
        <DialogProvider>
          <Button variant="primary">Continue</Button>
          <Toast.Region />
        </DialogProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
```

The host needs a Solid-aware bundler that handles CSS and asset URLs. Public
imports are the explicit subpaths in `package.json`; there is no root barrel or
wildcard export. Components import their own CSS. The production gallery at
`test/browser/` exercises these imports without Tailwind utility generation.

`styles.css` includes generated tokens, font faces, Tailwind's preflight reset,
and Web's shared typography/accessibility foundation. Hosts wanting only variables
or fonts can import `tokens.css` and `fonts.css` separately. Foundation import is
an explicit document-wide opt-in; it does not size the application viewport.
Font and file-icon URLs are package-relative and rewritten by the bundler.

## Theme lifetime and prepaint

Mount one `ThemeProvider` per document. Components may consume inherited tokens
without mounting a provider. `useTheme()` returns:

- `theme()`, `scheme()`, `mode()` — selected theme, preference, resolved mode.
- `list()`, `name(id)` — available theme IDs and display names.
- `setTheme(id)`, `setScheme(scheme)` — update and persist selection.

`Theme.ID` is `"bymorning" | "ink" | "paper"`; `Theme.Mode` is
`"light" | "dark"`; `Theme.Scheme` also accepts `"system"`. Invalid persisted
values normalize to ByMorning/dark. Storage errors leave in-memory selection
usable. Media changes affect system mode, and storage events synchronize tabs.
Unmounting removes listeners, while retaining the document's last theme.

Storage keys remain `bymorning-theme-id` and `bymorning-color-scheme`. Theme
selection changes root attributes, background and theme-color metadata. This is
a document theme, not a nested independent theme system.

For prepaint, resolve `@bymorning/ui/theme-preload.js` at build time and inline its
contents in a parser-blocking `<script>` in the document head, before application
JavaScript. Alternatively copy it to a host-owned public URL and use a classic
blocking script. The gallery's Vite config demonstrates inline delivery; include
the script in the host's CSP policy when applicable. No application import runs
the preload implicitly.

Theme JSON, validation and palette resolution run only in the generator. Browser
code imports the lightweight selection model and adapters. See
[theme architecture](./src/theme/README.md). Run `theme:generate` after changing
definitions; `theme:check` detects drift. Generated CSS is excluded from Prettier.

## Components

| Area                 | Public components                                                          |
| -------------------- | -------------------------------------------------------------------------- |
| Actions              | Button, IconButton, ActionMenu                                             |
| Input                | TextInput, Textarea, Checkbox, Switch, RadioGroup, RadioItem, Field        |
| Selection            | Select, SearchSelect, MaterialPicker, SegmentedControl                     |
| Menus and disclosure | Menu, DropdownMenu, Accordion, Collapsible                                 |
| Dialogs              | Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, ConfirmDialog |
| Feedback             | Tooltip, Toast, Loader, Spinner, ProgressCircle, TextShimmer               |
| Visuals              | Icon, FileIcon, Avatar, ProjectAvatar, Tag, Keybind                        |
| Layout               | FileTree, ScrollView, ResizeHandle                                         |

Compound anatomy stays on its owner: `Field.Label`, `Menu.Item`, `Dialog.TitleGroup`,
`SegmentedControl.Item`, etc. Long prop names are available as owner-scoped types,
such as `IconButton.Props` and `MaterialPicker.Props<Item>`. Source-compatible
two-word types such as `ButtonProps` remain exported.

`SearchSelect` accepts a host-owned model (`options`, `current`, `pending`,
`select`) and controlled open state. The default English label and private DOM
anatomy remain the source's Model/model-selector; pass explicit labels for other
uses. Model-specific compatibility aliases are private.

`FileTree` takes paths and reports selected paths. `ScrollView` requires a
host-constrained height; it does not invent a virtual viewport or fetch content.

## Dialogs, portals and localization

`DialogProvider` owns a sibling portal stack. `useDialog().show(factory)` replaces
it, `push(factory)` adds a layer, and `close()` closes the top layer. Factories
retain the caller's Solid owner context. The top dialog alone traps focus;
content can prevent Escape dismissal. Closing the final dialog restores the
original trigger, and teardown disposes dialog roots and timers.

Kobalte `Portal` renders popups,
and `Dialog.Content` is the inner modal panel. There is no `OverlayHost` API.
Tooltips use Kobalte's top-layer marker to remain accessible alongside a modal.

`ConfirmDialog` preserves its synchronous/async callback distinction: async
rejection produces a localized error toast and clears pending state; a synchronous
throw propagates. `Toast`, `showToast`, and `toaster` preserve the source's
module-global deduplication state. Use one `Toast.Region` per application, not
independent concurrent toast regions.

`I18nProvider` is optional: English fallback works without it. `createI18n(locale,
overrides)` accepts a locale accessor and partial typed catalog. `I18n.Key`,
`I18n.Catalog` and `I18n.Interface` expose the contract; parameterized messages
retain typed arguments. Locale selection remains host-owned. Kobalte receives the
same locale for direction and accessibility behavior.

## Verify

From this package:

```sh
bun run typecheck
bun run lint
bun run format:check
bun run theme:check
bun run test
bun run build
bun run test:browser
```

The browser suite builds its own production gallery and starts a strict-port
preview server under `/ui/` (override `PLAYWRIGHT_PORT` to use a different free
port). It verifies asset delivery, all six theme combinations, prepaint without
app JavaScript, system/cross-tab changes, input/selection, dialogs/portals,
disclosure, scrolling, toasts and teardown. Screenshots and traces are retained
on failure and ignored by Git.

Fonts and their original notices are under `src/assets/fonts/`. This remains a
private workspace package.
