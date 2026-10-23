import { I18nProvider, createI18n } from "@bymorning/ui/context/i18n"
import { ThemeProvider } from "@bymorning/ui/theme"
import { WorkspaceProvider } from "@/runtime/workspace.js"
import { Routes } from "@/shell/routes/routes.js"

export function App() {
  const i18n = createI18n()
  return (
    <ThemeProvider>
      <I18nProvider value={i18n}>
        <WorkspaceProvider>
          <Routes />
        </WorkspaceProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
