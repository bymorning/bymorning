import { Router } from "@solidjs/router"
import type { JSX } from "solid-js"

import { CommandProvider } from "./shell/commands/context"
import { DialogProvider } from "./context/dialog"
import { SDKProvider } from "./context/sdk"
import { SettingsProvider } from "./context/settings"
import { AppRoutes } from "./shell/routes/routes"
import { ThemeProvider } from "./ui/theme"
import { OverlayHost } from "./ui/components/overlay-host"
import { Toast } from "./ui/components/toast"

/** Mount the application router and its route hierarchy. */
export default function App(): JSX.Element {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <DialogProvider>
          <OverlayHost>
            <CommandProvider>
              <SDKProvider>
                <Router>
                  <AppRoutes />
                </Router>
              </SDKProvider>
            </CommandProvider>
          </OverlayHost>
          <Toast.Region />
        </DialogProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}
