import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import { I18nProvider as BmUiI18nProvider, createI18n as createBmUiI18n, useI18n } from "@bymorning/ui/context/i18n"

afterEach(cleanup)

describe("typed UI localization", () => {
  it("resolves string and parameterized fallback messages with catalog-owned grammar", () => {
    const i18n = createBmUiI18n()

    expect(i18n.t("ui.tool.subagent.delegating")).toBe("Delegating")
    expect(i18n.t("ui.session.background.summary", { count: 0 })).toBe("0 tasks in background")
    expect(i18n.t("ui.session.background.summary", { count: 1 })).toBe("1 task in background")
    expect(i18n.t("ui.session.background.summary", { count: 3 })).toBe("3 tasks in background")
    expect(i18n.t("ui.tool.subagent.error", { message: "Unavailable" })).toBe("Error: Unavailable")

    const _assertTypedCalls = () => {
      // @ts-expect-error Parameterized messages require their argument object.
      i18n.t("ui.session.background.summary")
      // @ts-expect-error String messages do not accept arguments.
      i18n.t("ui.tool.subagent.delegating", { count: 1 })
    }
  })

  it("uses provider overrides and falls back for keys the locale does not override", () => {
    const value = createBmUiI18n(() => "es", {
      "ui.session.background.summary": ({ count }) => (count === 1 ? "1 tarea activa" : `${count} tareas activas`),
      "ui.session.background.command": "Continuar",
      "ui.session.background.commandDescription": "Dejar tareas activas",
      "ui.session.background.commandError": "No se pudo continuar",
      "ui.session.background.commandCategory": "Sesión",
      "ui.tool.subagent.delegating": "Delegando",
    })
    const Consumer = () => {
      const i18n = useI18n()
      return (
        <div>
          <span>{i18n.locale()}</span>
          <span>{i18n.t("ui.tool.subagent.delegating")}</span>
          <span>{i18n.t("ui.session.background.summary", { count: 2 })}</span>
          <span>{i18n.t("ui.session.background.command")}</span>
          <span>{i18n.t("ui.session.background.commandDescription")}</span>
          <span>{i18n.t("ui.session.background.commandError")}</span>
          <span>{i18n.t("ui.session.background.commandCategory")}</span>
          <span>{i18n.t("ui.tool.subagent.completed")}</span>
        </div>
      )
    }

    render(() => (
      <BmUiI18nProvider value={value}>
        <Consumer />
      </BmUiI18nProvider>
    ))

    expect(screen.getByText("es")).toBeInTheDocument()
    expect(screen.getByText("Delegando")).toBeInTheDocument()
    expect(screen.getByText("2 tareas activas")).toBeInTheDocument()
    expect(screen.getByText("Continuar")).toBeInTheDocument()
    expect(screen.getByText("Dejar tareas activas")).toBeInTheDocument()
    expect(screen.getByText("No se pudo continuar")).toBeInTheDocument()
    expect(screen.getByText("Sesión")).toBeInTheDocument()
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })
})
