import { Command } from "@bymorning/core/command"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Workspace command catalog endpoint implementation. */
export const CommandHandler = HttpApiBuilder.group(Api, "api.command", (handlers) =>
  handlers.handle("command.list", () => Command.Service.use((command) => command.list())),
)
