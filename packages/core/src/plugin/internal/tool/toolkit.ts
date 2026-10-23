/** ByMorning's operational Toolkit Plugin contribution. */
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"
import { Actor } from "../../../actor.js"
import { Mcp } from "../../../mcp.js"
import { McpTool } from "../../../tool/mcp.js"
import { Skill } from "../../../skill.js"
import { PluginRuntime } from "../../runtime.js"
import { registerIntegrationTools } from "./toolkit-integration.js"
import { registerMcpTools } from "./toolkit-mcp.js"
import { registerPluginTools } from "./toolkit-plugin.js"
import { registerPolicyTools } from "./toolkit-policy.js"
import { registerScheduleTools } from "./toolkit-schedule.js"
import { registerSkillTools } from "./toolkit-skill.js"
import { ToolkitNamespace } from "./toolkit-shared.js"

export const ToolkitPlugin = define({
  id: "bymorning.toolkit",
  effect: Effect.fn("Toolkit.setup")(function* (context) {
    const mcp = yield* Mcp.Service
    const mcpTool = yield* McpTool.Service
    const skill = yield* Skill.Service
    const runtime = yield* PluginRuntime.Service
    // The session member's verified identity; Toolkit Tools forward it to Core
    // mutations so the domain's administrator rule applies to model-driven calls.
    const binding = yield* Actor.Binding.Service
    const { Config } = yield* Effect.promise(() => import("../../../config.js"))
    const config = yield* Config.Service
    const { Routing } = yield* Effect.promise(() => import("../../../routing.js"))
    const routing = yield* Effect.serviceOption(Routing.Service)

    yield* context.tool.transform((editor) => {
      editor.namespace({
        name: ToolkitNamespace,
        description:
          "Use when the user wants to configure a policy, Skill, MCP server, Integration authorization, or a Scheduled Task that runs a prompt on a recurring schedule, or to inspect the plugin and Integration inventory after authoring a Project plugin.",
      })
      registerMcpTools(editor, { mcp, mcpTool, config })
      registerIntegrationTools(editor, { integration: context.integration })
      registerPluginTools(editor, { plugin: context.plugin })
      registerPolicyTools(editor, config, Actor.Binding.actor(binding), routing._tag === "Some" ? routing.value.check : undefined)
      registerSkillTools(editor, skill)
      registerScheduleTools(editor, runtime.scheduledTask)
    })
  }),
})
