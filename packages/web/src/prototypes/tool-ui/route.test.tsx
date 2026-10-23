import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import { ThemeProvider, THEME_STORAGE } from "../../ui/theme"
import { projectResource, prototypeFamilies, prototypeScenarios, toolStates } from "./fixtures"
import { ToolUIPrototypeRoute } from "./route"
import { decodeProjectPath, permissionCopy, toolCopy } from "./suggested-language"

afterEach(() => {
  cleanup()
  localStorage.removeItem(THEME_STORAGE.scheme)
  document.documentElement.removeAttribute("data-theme")
})

const permissionActions = [
  "read", "write", "edit", "execute", "glob", "grep", "shell", "skill", "subagent",
  "websearch", "webfetch", "tool_output", "question", "config_get", "config_update",
  "mcp_connect", "mcp_list", "integration_connect", "docs_search", "local_ping", "custom_report",
] as const

describe("Tool UI prototype", () => {
  it("mounts as an isolated static route without workspace, data, or SDK providers", () => {
    mount()

    expect(screen.getByRole("heading", { name: "Tool UI prototype" })).toBeInTheDocument()
    expect(screen.getByText(`Showing ${prototypeScenarios.length} of ${prototypeScenarios.length} scenarios`)).toBeInTheDocument()
    expect(document.querySelector("[data-component='workspace-layout']")).not.toBeInTheDocument()
  })

  it("covers every renderer family, all reachable states, groups, permissions, and hidden projections", () => {
    const toolNames = prototypeScenarios.flatMap((scenario) => scenario.kind === "tool" ? [scenario.tool.name] : [])
    expect(new Set(toolNames)).toEqual(new Set([
      "custom_report", "webfetch", "mcp_catalog_search", "task", "read", "list", "glob", "grep", "write", "edit", "shell", "execute", "skill", "subagent",
    ]))
    expect(new Set(prototypeScenarios.map((scenario) => scenario.kind === "tool" ? scenario.tool.state.type : scenario.state))).toEqual(new Set(toolStates))
    expect(prototypeFamilies).toEqual(expect.arrayContaining(["Grouped tools", "Permission", "Projection-hidden"]))
    expect(prototypeScenarios.filter((scenario) => scenario.kind === "permission").map((scenario) => scenario.item.action)).toEqual(expect.arrayContaining([...permissionActions]))
    expect(prototypeScenarios.filter((scenario) => scenario.kind === "permission").some((scenario) => scenario.item.action === "filesystem.read")).toBe(false)
    expect(prototypeScenarios.filter((scenario) => scenario.kind === "hidden").map((scenario) => scenario.toolName)).toEqual(["question", "todowrite"])
  })

  it("intersects family and state filters and reflects clean filter state in the URL", async () => {
    const user = userEvent.setup()
    const history = mount()
    await user.click(within(screen.getByRole("group", { name: "Tool / family filter" })).getByRole("button"))
    await user.click(await screen.findByRole("option", { name: "File tools" }))
    await user.click(within(screen.getByRole("group", { name: "State filter" })).getByRole("button"))
    await user.click(await screen.findByRole("option", { name: "failed" }))

    expect(screen.getByText(`Showing 1 of ${prototypeScenarios.length} scenarios`)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Edit · failed" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "MCP fallback · failed" })).not.toBeInTheDocument()
    expect(decodeURIComponent(history.get())).toContain("family=File+tools")
    expect(history.get()).toContain("state=failed")
  })

  it("synchronizes disclosure across current and suggested cells while preserving current ARIA", async () => {
    const user = userEvent.setup()
    mount("?family=Generic+%2F+fallback&state=succeeded")
    await user.click(screen.getByRole("button", { name: "Expanded" }))

    const row = screen.getByRole("heading", { name: "Unknown tool · succeeded" }).closest("article")
    if (!row) throw new Error("Expected generic scenario")
    const current = within(row).getByRole("region", { name: "Unknown tool · succeeded, Current implementation" })
    const suggested = within(row).getByRole("region", { name: "Unknown tool · succeeded, Suggested design" })
    const currentTrigger = within(current).getByRole("button", { name: /Weekly report.*Expanded/i })
    const suggestedTrigger = within(suggested).getByRole("button", { name: /Called Weekly report.*Expanded/i })
    expect(currentTrigger).toHaveAttribute("aria-expanded", "true")
    expect(suggestedTrigger).toHaveAttribute("aria-expanded", "true")
    expect(within(suggested).getByText("Report saved locally.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Collapsed" }))
    expect(within(current).getByRole("button", { name: /Weekly report.*Collapsed/i })).toHaveAttribute("aria-expanded", "false")
    expect(within(suggested).getByRole("button", { name: /Called Weekly report.*Collapsed/i })).toHaveAttribute("aria-expanded", "false")
  })

  it("renders repeated mobile cell labels and creates no duplicate ids", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole("button", { name: "Expanded" }))
    expect(screen.getAllByRole("heading", { name: "Current implementation" })).toHaveLength(prototypeScenarios.length)
    expect(screen.getAllByRole("heading", { name: "Suggested design" })).toHaveLength(prototypeScenarios.length)
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("offers System, Light, and Dark using the existing theme context", () => {
    localStorage.setItem(THEME_STORAGE.scheme, "system")
    mount()
    const system = screen.getByRole("button", { name: "System" })
    const light = screen.getByRole("button", { name: "Light" })
    const dark = screen.getByRole("button", { name: "Dark" })
    expect(system).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(light)
    expect(light).toHaveAttribute("aria-pressed", "true")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    fireEvent.click(dark)
    expect(dark).toHaveAttribute("aria-pressed", "true")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })

  it("keeps current succeeded file previews while reducing suggested files to basename rows", () => {
    mount("?family=File+tools&state=succeeded&open=1")

    for (const scenario of prototypeScenarios.filter((item) => item.kind === "tool" && item.tool.state.type === "succeeded" && (item.tool.name === "write" || item.tool.name === "edit"))) {
      if (scenario.kind !== "tool") continue
      const row = screen.getByRole("heading", { name: scenario.title }).closest("article")
      if (!row) throw new Error(`Expected ${scenario.title} scenario`)
      const current = within(row).getByRole("region", { name: `${scenario.title}, Current implementation` })
      const suggested = within(row).getByRole("region", { name: `${scenario.title}, Suggested design` })
      const path = String(scenario.tool.input.path)
      const name = path.split("/").at(-1)!

      expect(current.querySelector("pre, [data-component='file-diff'], [data-component='file-content']")).toBeInTheDocument()
      expect(within(suggested).getByText("View file")).toBeInTheDocument()
      expect(within(suggested).getByText(name)).not.toHaveAttribute("title")
      expect(suggested.querySelector('[data-slot="suggested-file"]')).toHaveAttribute("title", path)
      expect(suggested.querySelector('[data-slot="suggested-file"]')).toHaveAttribute("aria-label", `View file ${path}`)
      expect(suggested).not.toHaveTextContent(path)
      expect(suggested.querySelector("pre")).not.toBeInTheDocument()
      expect(suggested).not.toHaveTextContent(/preview|diff|diagnostic|additions|deletions|changes?|source|output/i)
    }
  })

  it("keeps every succeeded suggested design icon-free and uses exact stem language", () => {
    mount("?state=succeeded")

    for (const scenario of prototypeScenarios.filter((item) => (item.kind === "tool" ? item.tool.state.type : item.state) === "succeeded")) {
      const row = screen.getByRole("heading", { name: scenario.title }).closest("article")
      if (!row) throw new Error(`Expected ${scenario.title} scenario`)
      const suggested = within(row).getByRole("region", { name: `${scenario.title}, Suggested design` })
      expect(suggested.querySelector("svg, [data-component='icon'], [data-slot*='icon']")).not.toBeInTheDocument()
      expect(suggested.querySelector('[data-slot="suggested-state"]')).not.toBeInTheDocument()
      expect(suggested).not.toHaveTextContent(/\b(succeeded|success|complete|completed)\b/i)
    }

    expect(screen.getByRole("region", { name: "Unknown tool · succeeded, Suggested design" })).toHaveTextContent(/Called.*Weekly report/)
    expect(screen.getByRole("region", { name: "Shell · succeeded, Suggested design" })).toHaveTextContent(/Ran.*bun test route.test.tsx/)
    expect(screen.getByRole("region", { name: "Skill · succeeded, Suggested design" })).toHaveTextContent(/Read.*SolidJS Best Practices.*skill/)
    expect(screen.getByRole("region", { name: "Subagent · background, Suggested design" })).toHaveTextContent(/Delegated to.*explore.*agent/)
    expect(screen.getByRole("region", { name: "FileToolGroup · succeeded, Suggested design" })).toHaveTextContent(/Wrote.*2 files/)
    expect(screen.getByRole("region", { name: "List · succeeded, Suggested design" })).toHaveTextContent(/Read.*src\/prototypes\/tool-ui\//)
    expect(screen.getByRole("region", { name: "Glob · succeeded, Suggested design" })).toHaveTextContent(/Read.*\*\*\/\*\.tsx/)
    expect(document.querySelectorAll('[data-slot="suggested-output"]')).toHaveLength(3)
    expect(screen.getByRole("region", { name: "Unknown tool · succeeded, Suggested design" })).not.toHaveTextContent(/"format"|"rows"/)
  })

  it("uses basename subjects with full-path accessibility for file tools", () => {
    mount("?family=Context+tools&state=running")

    const row = screen.getByRole("heading", { name: "Read · running" }).closest("article")
    if (!row) throw new Error("Expected read scenario")
    const suggested = within(row).getByRole("region", { name: "Read · running, Suggested design" })
    const subject = suggested.querySelector('[data-slot="suggested-subject"]')
    expect(suggested).toHaveTextContent(/Reading/)
    expect(subject).toHaveTextContent("route.tsx")
    expect(subject).toHaveAttribute("title", "src/session/route.tsx")
    expect(within(suggested).getByRole("group", { name: "Reading src/session/route.tsx" })).toBeInTheDocument()
    expect(suggested).not.toHaveTextContent("src/session/route.tsx")
  })

  it("communicates non-success states as a prefix plus bare stem without a second badge", () => {
    mount("?state=failed")

    for (const scenario of prototypeScenarios.filter((item) => (item.kind === "tool" ? item.tool.state.type : item.state) === "failed" && item.kind === "tool")) {
      const row = screen.getByRole("heading", { name: scenario.title }).closest("article")
      if (!row) throw new Error(`Expected ${scenario.title} scenario`)
      const suggested = within(row).getByRole("region", { name: `${scenario.title}, Suggested design` })
      expect(suggested.querySelector('[data-slot="suggested-state"]')).not.toBeInTheDocument()
      expect(suggested.querySelector('[data-slot="suggested-verb"]')).toHaveTextContent(/^Failed (Read|Write|Run|Delegate|Call)/)
      expect(suggested.querySelector('[data-slot="suggested-verb"]')).toHaveAttribute("data-tone", "danger")
      expect(suggested.querySelector('[data-slot="suggested-output"] [data-tone="danger"]')).toBeInTheDocument()
      expect(suggested.querySelector('[data-component="suggested-tool"]')).not.toHaveAttribute("data-tone", "danger")
    }

    expect(screen.getByRole("region", { name: "Edit · failed, Suggested design" })).toHaveTextContent(/Failed Write/)
    expect(screen.getByRole("region", { name: "MCP fallback · failed, Suggested design" })).toHaveTextContent(/Failed Call/)
    expect(screen.getByRole("region", { name: "Subagent · failed, Suggested design" })).toHaveTextContent(/Failed Delegate to/)
  })

  it("keeps interrupted and stopped states textual with the same stem prefix", () => {
    mount("?state=interrupted")
    expect(screen.getByRole("region", { name: "Grep · interrupted, Suggested design" })).toHaveTextContent(/Interrupted Read.*ToolDisplay/)
    expect(screen.getByRole("region", { name: "Execute · interrupted, Suggested design" })).toHaveTextContent(/Interrupted Run.*scripts\/inventory\.ts/)
    cleanup()
    mount("?state=stopped")
    expect(screen.getByRole("region", { name: "Write · stopped, Suggested design" })).toHaveTextContent(/Stopped Write.*draft\.ts/)
    expect(screen.getByRole("region", { name: "Task fallback · stopped, Suggested design" })).toHaveTextContent(/Stopped Call.*Inventory renderers/)
  })

  it("renders running stems without a separate status badge", () => {
    mount("?state=running")
    expect(screen.getByRole("region", { name: "Write · running, Suggested design" })).toHaveTextContent(/Writing.*example\.ts/)
    expect(screen.getByRole("region", { name: "Shell · running, Suggested design" })).toHaveTextContent(/Running.*bun test route.test.tsx/)
    expect(screen.getByRole("region", { name: "Skill · running, Suggested design" })).toHaveTextContent(/Reading.*solidjs-best-practices.*skill/)
    expect(screen.getByRole("region", { name: "Subagent · input streaming, Suggested design" })).toHaveTextContent("Delegating")
    expect(screen.getByRole("region", { name: "Subagent · input streaming, Suggested design" }).querySelector('[data-slot="suggested-subject"]')).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Web fallback · running, Suggested design" })).toHaveTextContent(/Calling.*https:\/\/example\.test\/reference/)
    expect(screen.getByRole("region", { name: "ContextToolGroup · running, Suggested design" })).toHaveTextContent(/Reading.*2 context calls/)
  })

  it("shimmers every visible part of every running suggested tool, but not pending permissions", () => {
    mount("?state=running")

    const runningTools = prototypeScenarios.filter((item) => item.kind === "tool"
      ? item.tool.state.type === "running"
      : (item.kind === "context-group" || item.kind === "file-group") && item.state === "running")
    for (const scenario of runningTools) {
      const row = screen.getByRole("heading", { name: scenario.title }).closest("article")
      if (!row) throw new Error(`Expected ${scenario.title} scenario`)
      const suggested = within(row).getByRole("region", { name: `${scenario.title}, Suggested design` })
      const parts = suggested.querySelectorAll('[data-slot="suggested-phrase"] > [data-slot]')
      expect(parts.length).toBeGreaterThan(0)
      for (const part of parts) expect(part.querySelector('[data-component="text-shimmer"]')).toBeInTheDocument()
    }

    const pending = screen.getByRole("heading", { name: "Permission · pending" }).closest("article")
    if (!pending) throw new Error("Expected pending permission scenario")
    expect(within(pending).getByRole("region", { name: "Permission · pending, Suggested design" }).querySelector('[data-component="text-shimmer"]')).not.toBeInTheDocument()
  })

  it("keeps non-running suggested tools static", () => {
    mount("?state=succeeded")
    for (const suggested of screen.getAllByRole("region", { name: /Suggested design$/ })) {
      expect(suggested.querySelector('[data-component="text-shimmer"]')).not.toBeInTheDocument()
    }
  })

  it("reduces suggested permissions to a sentence, Reject, and Once", () => {
    mount("?family=Permission")

    const permissions = prototypeScenarios.filter((item) => item.kind === "permission")
    expect(permissions.length).toBeGreaterThan(20)
    for (const scenario of permissions) {
      const row = screen.getByRole("heading", { name: scenario.title }).closest("article")
      if (!row) throw new Error(`Expected ${scenario.title} scenario`)
      const suggested = within(row).getByRole("region", { name: `${scenario.title}, Suggested design` })
      const current = within(row).getByRole("region", { name: `${scenario.title}, Current implementation` })
      const copy = permissionCopy(scenario)
      expect(current.querySelector('[data-component="permission-view"]')).toBeInTheDocument()
      expect(suggested.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-label", copy.accessible)
      expect(suggested).toHaveTextContent(visiblePermission(copy))
      expect(suggested).not.toHaveTextContent(/Permission required|Action|Resources|Always/)
      expect(within(suggested).queryByRole("button", { name: "Always" })).not.toBeInTheDocument()
      expect(within(suggested).getByRole("group", { name: "Permission response" })).toBeInTheDocument()
      for (const action of ["Reject", "Once"]) {
        const button = within(suggested).getByRole("button", { name: action })
        if (scenario.pending) expect(button).toBeDisabled()
        if (!scenario.pending) expect(button).toBeEnabled()
      }
      if (scenario.error) expect(within(suggested).getByRole("alert")).toHaveTextContent(scenario.error)
    }
  })

  it("shows file basenames, full paths for AT, all resources, and omits wildcards", () => {
    mount("?family=Permission")

    const read = suggested("Permission · read")
    expect(read.querySelector('[data-slot="suggested-permission-resource"]')).toHaveTextContent("route.tsx")
    expect(read.querySelector('[data-slot="suggested-permission-resource"]')).toHaveAttribute("title", "src/session/route.tsx")
    expect(read.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-label", "Asking permission to read src/session/route.tsx?")
    expect(read).not.toHaveTextContent("src/session/route.tsx")

    const fallback = suggested("Permission · read fallback")
    expect(fallback.querySelector('[data-slot="suggested-permission-resource"]')).toHaveTextContent("timeline.ts")
    expect(fallback.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-label", "Asking permission to read src/session/timeline.ts?")

    const glob = suggested("Permission · glob")
    expect(glob).toHaveTextContent("Asking permission to match **/*.tsx?")

    const question = suggested("Permission · question")
    expect(question.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-label", "Asking permission to ask questions?")
    expect(question).not.toHaveTextContent("*")

    const config = suggested("Permission · config_get")
    expect(config).toHaveTextContent("Asking permission to read gateway, permissions?")
    expect(config).not.toHaveTextContent("+")

    const output = suggested("Permission · tool_output")
    expect(output.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-label", "Asking permission to read stored output?")
    expect(output).not.toHaveTextContent("out_")

    const invalid = suggested("Permission · read invalid")
    expect(invalid).toHaveTextContent(`project:prj_00000000000000000000000001:%E0%A4%A`)
  })

  it("keeps suggested pending permission state semantic without a status indicator", () => {
    mount("?family=Permission&state=running")

    const row = screen.getByRole("heading", { name: "Permission · pending" }).closest("article")
    if (!row) throw new Error("Expected pending permission scenario")
    const current = within(row).getByRole("region", { name: "Permission · pending, Current implementation" })
    const suggested = within(row).getByRole("region", { name: "Permission · pending, Suggested design" })

    expect(current.querySelector('[data-component="permission-view"]')).toHaveAttribute("aria-busy", "true")
    expect(suggested.querySelector('[data-component="suggested-permission"]')).toHaveAttribute("aria-busy", "true")
    expect(within(suggested).queryByText("Pending")).not.toBeInTheDocument()
    expect(suggested.querySelector('[data-component="spinner"], [data-slot*="spinner"]')).not.toBeInTheDocument()
    expect(within(suggested).queryByRole("progressbar")).not.toBeInTheDocument()
    expect(suggested.querySelector("svg")).not.toBeInTheDocument()
    expect(within(suggested).queryByRole("button", { name: "Always" })).not.toBeInTheDocument()
    for (const action of ["Reject", "Once"]) {
      expect(within(suggested).getByRole("button", { name: action })).toBeDisabled()
    }
  })

  it("maps permission families and tool stems without throwing on invalid encoding", () => {
    expect(decodeProjectPath(projectResource("src/session/timeline.ts"))).toBe("src/session/timeline.ts")
    expect(decodeProjectPath("project:prj_00000000000000000000000001:%E0%A4%A")).toBeUndefined()
    expect(permissionCopy(permissionScenario("permission-question")).accessible).toBe("Asking permission to ask questions?")
    expect(permissionCopy(permissionScenario("permission-mcp-outbound")).accessible).toBe("Asking permission to call docs_search?")
    expect(permissionCopy(permissionScenario("permission-openapi")).accessible).toBe("Asking permission to call local_ping on https://api.example.test?")
    expect(toolCopy(toolScenario("skill-succeeded")).accessible).toBe("Read SolidJS Best Practices skill")
    expect(toolCopy(toolScenario("subagent-streaming")).accessible).toBe("Delegating")
    expect(toolCopy(toolScenario("subagent-background")).accessible).toBe("Delegated to explore agent Inventory tool renderers")
  })
})

function permissionScenario(id: string) {
  const scenario = prototypeScenarios.find((item) => item.id === id)
  if (scenario?.kind !== "permission") throw new Error(`Expected permission ${id}`)
  return scenario
}

function toolScenario(id: string) {
  const scenario = prototypeScenarios.find((item) => item.id === id)
  if (scenario?.kind !== "tool") throw new Error(`Expected tool ${id}`)
  return scenario
}

function visiblePermission(copy: ReturnType<typeof permissionCopy>) {
  return copy.resources.length === 0
    ? `${copy.preamble} ${copy.action}?`
    : `${copy.preamble} ${copy.action} ${copy.resources.map((resource) => resource.visible).join(", ")}?`
}

function suggested(title: string) {
  const row = screen.getByRole("heading", { name: title }).closest("article")
  if (!row) throw new Error(`Expected ${title} scenario`)
  return within(row).getByRole("region", { name: `${title}, Suggested design` })
}

function mount(search = "") {
  const history = createMemoryHistory()
  history.set({ value: `/__prototype/tool-ui${search}`, replace: true, scroll: false })
  render(() => (
    <ThemeProvider>
      <MemoryRouter history={history}>
        <Route path="/__prototype/tool-ui" component={ToolUIPrototypeRoute} />
      </MemoryRouter>
    </ThemeProvider>
  ))
  return history
}
