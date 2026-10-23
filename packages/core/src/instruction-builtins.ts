export * as InstructionBuiltIns from "./instruction-builtins.js"

import type { Project } from "@bymorning/schema/project"
import type { Session } from "@bymorning/schema/session"
import type { User } from "@bymorning/schema/user"
import type { Workspace } from "@bymorning/schema/workspace"
import { DateTime, Effect, Schema } from "effect"
import { Instruction } from "./instruction.js"

/**
 * The web application's real destinations, so the model names an actual page
 * instead of inventing one. Labels and paths mirror
 * `packages/web/src/workspace-route-paths.ts` and
 * `packages/web/src/project/sidebar/navigation.ts`; Core cannot import the web
 * package, so keep the two in step when a label or path changes.
 */
export const Surface = {
  /** Main sidebar entries every member sees. */
  sidebar: ["Overview", "Scheduled tasks"],
  /**
   * Integrations is a Console page (Workspace administrators): registered
   * integrations and their OAuth clients, outbound MCP servers, web search.
   * Members connect their own account through the command palette dialog.
   */
  integrations: { label: "Integrations", path: "/mcp", command: "Connect integration" },
  /** Console is the Workspace-administrator area, grouped exactly as in the UI. */
  console: {
    label: "Console",
    groups: [
      { label: "Gateway", items: ["Overview", "Leaderboard", "Models", "Routing", "Integrations"] },
      { label: "Assistant", items: ["Agents", "Skills"] },
      { label: "Workspace", items: ["Members", "Service accounts", "SSO", "Audit log", "Budgets"] },
      { label: "Installation", items: ["Installation", "Installation Policy"] },
    ],
  },
  installation: { label: "Installation", path: "/installation" },
  installationPolicy: { label: "Installation Policy", path: "/installation/policy" },
} as const

const href = (workspaceID: Workspace.ID, path: string) => `/w/${workspaceID}${path}`

/** Render the application surface the member actually has, with the member's Role when the Session is member-bound. */
export const surface = (input: { readonly workspaceID: Workspace.ID; readonly role: User.Role | undefined }) =>
  [
    "<app>",
    ...(input.role === undefined
      ? []
      : [
          `  The member you are assisting has the ${input.role} Role in this Workspace${
            input.role === "admin"
              ? "; they can open the Console and configure Integrations' OAuth clients."
              : "; they cannot open the Console or configure Integrations' OAuth clients, and must ask a Workspace administrator for those."
          }`,
        ]),
    `  Main sidebar: ${Surface.sidebar.join(", ")}.`,
    `  ${Surface.integrations.label}: a Console page at ${href(input.workspaceID, Surface.integrations.path)} listing what the Workspace is connected to (services, web search providers, outbound MCP servers; model Providers live on the Models page) with one "Add integration" picker that also accepts a custom MCP server. A Workspace administrator saves each integration's OAuth client ID and secret there. Any member connects their own account with the "${Surface.integrations.command}" command in the command palette or with toolkit.integration.connect. There is no application-level credential.`,
    `  ${Surface.console.label} (Workspace administrators only): ${Surface.console.groups
      .map((group) => `${group.label} (${group.items.join(", ")})`)
      .join("; ")}.`,
    `  ${Surface.installation.label} and ${Surface.installationPolicy.label}: ${href(input.workspaceID, Surface.installation.path)} and ${href(input.workspaceID, Surface.installationPolicy.path)}, managed by Installation Admins.`,
    `  There is no "Settings" section anywhere in ByMorning. Name the actual page above; never invent a navigation path or a permission the member does not have.`,
    "</app>",
  ].join("\n")

export function load(input: {
  readonly sessionID: Session.ID
  readonly workspaceID: Workspace.ID
  readonly projectID: Project.ID | undefined
  /** The Session member's Workspace Role; absent in a caller-less system context. */
  readonly role?: User.Role | undefined
}): Instruction.List {
  return Instruction.combine([
    Instruction.make({
      key: Instruction.Key.make("core/environment"),
      codec: Schema.toCodecJson(Schema.String),
      read: Effect.sync(() =>
        [
          "<env>",
          `  Current conversation session ID: ${input.sessionID}`,
          `  Workspace ID: ${input.workspaceID}`,
          ...(input.projectID === undefined ? [] : [`  Project ID: ${input.projectID}`]),
          "  Project files use a storage-backed, project-relative namespace.",
          "</env>",
        ].join("\n"),
      ),
      render: {
        initial: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        changed: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      },
    }),
    Instruction.make({
      key: Instruction.Key.make("core/surface"),
      codec: Schema.toCodecJson(Schema.String),
      read: Effect.sync(() => surface({ workspaceID: input.workspaceID, role: input.role })),
      render: {
        initial: (app) =>
          ["Here is how the ByMorning application you run inside is organized for this member:", app].join("\n"),
        changed: (_previous, app) => ["The ByMorning application is now organized as:", app].join("\n"),
      },
    }),
    Instruction.make({
      key: Instruction.Key.make("core/date"),
      codec: Schema.toCodecJson(Schema.String),
      read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
      render: {
        initial: (date) => `Today's date: ${date}`,
        changed: (_previous, date) => `Today's date is now: ${date}`,
      },
    }),
  ])
}
