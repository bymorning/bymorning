/** Declares the Config contract owned by this module. */
export * as Config from "./config.js"
export * as ConfigSchema from "./config.js"

import { Effect, Schema } from "effect"
import { ConfigPlugin } from "./config/plugin.js"
import { ConfigGateway } from "./config/gateway.js"
import * as ConfigToolOutput from "./config/tool-output.js"
import { ConfigMCP } from "./config/mcp.js"
import { ConfigWebSearch } from "./config/websearch.js"
import { ConfigCodeInterpreter } from "./config/code-interpreter.js"
import { Event as EventSchema } from "./event.js"
import * as SessionConfig from "./session/config.js"
import { AbsolutePath, optional } from "./schema.js"
import * as Model from "./model.js"
import * as Permission from "./permission.js"
import * as Provider from "./provider.js"
import * as RoutingSchema from "./routing.js"

export const ModelPolicy = Schema.Struct({
  disabled: Schema.Array(Model.Identity).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  seen: Schema.Array(Model.Identity).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  initialized: Schema.Array(Provider.Name).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})
export interface ModelPolicy extends Schema.Schema.Type<typeof ModelPolicy> {}

/** Provider availability for this Workspace. Omitted `allow` means all Providers; empty `allow` means none. */
export const Providers = Schema.Struct({
  allow: Schema.Array(Provider.Name).pipe(optional),
  activation: Schema.Record(Provider.Name, Provider.Status).pipe(optional),
})

/** Provider availability for this Workspace. */
export interface Providers extends Schema.Schema.Type<typeof Providers> {}

/** One ordered routing rule: conditions plus a Model or Tier target. Legacy `{to, from?, when?}` rules still decode. */
export const Routing = RoutingSchema.Rule

/** One ordered routing rule. */
export type Routing = RoutingSchema.Rule

/** Canonical Workspace Config accepting sparse encoded fields and decoding all domain defaults. */
export const Info = Schema.Struct({
  ...SessionConfig.Info.fields,
  permissions: Permission.Ruleset.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  plugins: ConfigPlugin.Plugins.pipe(optional),
  tool_output: ConfigToolOutput.Info.pipe(optional),
  mcp: ConfigMCP.Info.pipe(optional),
  websearch: ConfigWebSearch.Selection.pipe(optional),
  code_interpreter: ConfigCodeInterpreter.Selection.pipe(optional),
  gateway: ConfigGateway.Info.pipe(optional),
  providers: Providers.pipe(optional),
  routing: Schema.Array(Routing).pipe(optional),
  /** Workspace-configured custom Models; server-owned like `model_policy`. */
  models: Schema.Array(Model.Custom).pipe(optional),
  model_policy: ModelPolicy.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ disabled: [], seen: [], initialized: [] })),
  ),
})

/** Fully resolved Workspace runtime Config. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Sparse Workspace Config representation used by storage and transport inputs. */
export const Stored = Schema.toEncoded(Info)

/** Sparse Workspace Config representation used by storage and transport inputs. */
export interface Stored extends Schema.Schema.Type<typeof Stored> {}

/** A Config document, optionally rooted in an installation file. */
export class Document extends Schema.Class<Document>("Config.Document")({
  type: Schema.Literal("document"),
  path: AbsolutePath.pipe(optional),
  info: Info,
}) {}

export const Entry = Document
export type Entry = typeof Entry.Type

const Updated = EventSchema.define("config.updated", {})
/** Workspace Config invalidations consumed by scoped plugins. */
export const Event = { Updated, Definitions: EventSchema.inventory(Updated) }
