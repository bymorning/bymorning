import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@bymorning/httpapi-codegen"
import { Api } from "@bymorning/protocol/api"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"

const groupNames = {
  auth: "auth",
  "api.account": "account",
  "api.workspace": "workspace",
  "api.user": "user",
  "api.provider": "provider",
  "api.model": "model",
  "api.project": "project",
  "api.scheduledTask": "scheduledTask",
  "api.skill": "skill",
  "api.session": "session",
  "api.message": "message",
  "api.event": "event",
  "api.integration": "integration",
  "api.credential": "credential",
  "api.websearch": "websearch",
  "api.permission": "permission",
  "api.form": "form",
  "api.agent": "agent",
  "api.command": "command",
  "api.reference": "reference",
  "api.usage": "usage",
  "api.tool": "tool",
  "api.mcp": "mcp",
  "api.service-account": "serviceAccount",
  "api.budget": "budget",
  "api.license": "license",
  "api.installation": "installation",
} as const

const contract = compile(Api, { groupNames })

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(contract, {
          mutableOutputs: true,
          runtime: { module: "../../contract.js", api: "ClientApi" },
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(contract, {
          module: "../../contract.js",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(contract, {
          outputTypes: {
            "event.subscribe": {
              name: "WorkspaceEventItem",
              import: 'import type { WorkspaceEventItem } from "@bymorning/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
