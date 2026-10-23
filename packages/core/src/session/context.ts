export * as SessionContext from "./context.js"

import type { Permission } from "@bymorning/schema/permission"
import type { Project } from "@bymorning/schema/project"
import type { Session } from "@bymorning/schema/session"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Option } from "effect"
import { Actor } from "../actor.js"
import { CodeModeInstruction } from "../codemode/instruction.js"
import { InstructionBuiltIns } from "../instruction-builtins.js"
import { InstructionEntry } from "../instruction-entry.js"
import { Instruction } from "../instruction.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { OutboundMCPInstruction } from "../outbound-mcp-instruction.js"
import { Mcp } from "../mcp.js"
import { ReferenceInstruction } from "../reference-instruction.js"
import { Reference } from "../reference.js"
import { SkillInstruction } from "../skill-instruction.js"
import type { SessionTools } from "./tools.js"

/** Acquire the production Instruction composition point. */
export const make = Effect.gen(function* () {
  const skills = yield* SkillInstruction.Service
  const entries = yield* InstructionEntry.Service
  const references = yield* Reference.Service
  const mcp = yield* Mcp.Service
  const instructions = yield* InstructionDiscovery.Service
  // The retained member graph binds the verified member; a caller-less
  // (system) construction has no Role and the surface instruction omits it.
  const role = Option.map(yield* Effect.serviceOption(Actor.Binding.Service), (binding) => binding.role)
  return {
    load: Effect.fn("Session.Context.load")(function* (
      sessionID: Session.ID,
      permissions: Permission.Ruleset,
      tools: SessionTools.Snapshot | undefined,
      workspaceID: Workspace.ID,
      projectID: Project.ID | undefined,
    ) {
      const loaded = yield* Effect.all(
        {
          builtins: Effect.succeed(
            InstructionBuiltIns.load({ sessionID, workspaceID, projectID, role: Option.getOrUndefined(role) }),
          ),
          project: instructions.load(projectID),
          skills: skills.load(permissions),
          references: ReferenceInstruction.load(references),
            mcp: OutboundMCPInstruction.load({
              mcp,
              // Code Mode callables are intentionally absent from model tool
              // definitions; include its root catalog entries when deciding
              // whether MCP connection guidance is actionable.
              permitted: new Set([
                ...(tools?.definitions.map((definition) => definition.name) ?? []),
                ...(tools?.codeModeCatalog?.tools.flatMap((tool) => tool.type === "tool" ? [tool.name] : []) ?? []),
              ]),
            codeModeEnabled: tools?.codeModeCatalog !== undefined,
          }),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      return Instruction.combine([
        loaded.builtins,
        CodeModeInstruction.make(tools?.codeModeCatalog),
        loaded.project,
        loaded.skills,
        loaded.references,
        loaded.mcp,
        loaded.entries,
      ])
    }),
  }
})
