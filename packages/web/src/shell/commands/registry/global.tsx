import { SchemeDialog } from "../../../app/dialog-select-color-mode"
import { ThemeDialog } from "../../../app/dialog-select-theme"
import { IntegrationDialog } from "../../../integration/dialog/dialog"
import { useDialog } from "../../../context/dialog"
import { useSettings } from "../../../context/settings"
import { DialogCommandPalette } from "../palette/dialog-command-palette"

export function createGlobalCommands() {
  const dialog = useDialog()
  const settings = useSettings()
  return () =>
    [
      {
        id: "command.palette",
        title: "Commands",
        keybind: "mod+k,mod+shift+p",
        evenWhileTyping: true,
        onSelect: () => dialog.show(() => <DialogCommandPalette />),
      },
      {
        id: "reasoning.toggle",
        title: `${settings.general.showReasoningSummaries ? "Hide" : "Show"} reasoning summaries`,
        category: "Appearance",
        onSelect: settings.general.toggleReasoning,
      },
      {
        id: "markdown.toggle",
        title: settings.general.renderMarkdown ? "Show raw Markdown" : "Render Markdown",
        category: "Appearance",
        onSelect: settings.general.toggleMarkdown,
      },
      {
        id: "agent.toggle",
        title: `${settings.general.showAgent ? "Hide" : "Show"} agent`,
        category: "Appearance",
        onSelect: settings.general.toggleAgent,
      },
      {
        id: "usage.toggle",
        title: `${settings.general.showSessionUsage ? "Hide" : "Show"} session usage`,
        category: "Appearance",
        onSelect: settings.general.toggleSessionUsage,
      },
      {
        id: "variant.toggle",
        title: `${settings.general.showModelVariant ? "Hide" : "Show"} model variant`,
        category: "Appearance",
        onSelect: settings.general.toggleVariant,
      },
      {
        id: "integration.connect",
        title: "Connect integration",
        description: "Connect your account to a registered integration",
        category: "Commands",
        onSelect: () => dialog.show(() => <IntegrationDialog />),
      },
      {
        id: "theme.choose",
        title: "Choose theme",
        category: "Appearance",
        onSelect: () => dialog.show(() => <ThemeDialog />),
      },
      {
        id: "color.choose",
        title: "Choose color mode",
        category: "Appearance",
        onSelect: () => dialog.show(() => <SchemeDialog />),
      },
    ] as const
}
