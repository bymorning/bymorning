export * as Installation from "./installation.js"
export * as InstallationSchema from "./installation.js"

import { Schema } from "effect"
import * as Provider from "./provider.js"

/**
 * Installation-wide Provider admission restriction. A present `allow` is the
 * Installation allowlist every Workspace restriction is clamped against; an
 * omitted `allow` imposes no Installation restriction.
 */
export const Providers = Schema.Struct({
  allow: Schema.optionalKey(Schema.Array(Provider.Name)),
})

/** Installation-wide Provider admission restriction. */
export interface Providers extends Schema.Schema.Type<typeof Providers> {}

/** Installation-wide Plugin restriction: off entirely, or an allowlist of package names. */
export const Plugins = Schema.Union([Schema.Literal("off"), Schema.Struct({ allow: Schema.Array(Schema.String) })])

/** Installation-wide Plugin restriction. */
export type Plugins = typeof Plugins.Type

/** Invitation admission restriction replacing the default union of Auth Provider domains. */
export const Invitations = Schema.Struct({
  domains: Schema.optionalKey(Schema.Array(Schema.String)),
})

/** Invitation admission restriction replacing the default union of Auth Provider domains. */
export interface Invitations extends Schema.Schema.Type<typeof Invitations> {}

/**
 * Installation Policy: the Installation-owned mandatory restriction document
 * constraining every Workspace's effective Config and its admission behavior.
 * An omitted field imposes no restriction; a Workspace may tighten further,
 * never loosen. An omitted `provisioning` rejects uninvited first logins.
 */
export const Policy = Schema.Struct({
  providers: Schema.optionalKey(Providers),
  plugins: Schema.optionalKey(Plugins),
  websearch: Schema.optionalKey(Schema.Literal("off")),
  share: Schema.optionalKey(Schema.Literal("off")),
  provisioning: Schema.optionalKey(Schema.Literals(["open", "invite-only"])),
  invitations: Schema.optionalKey(Invitations),
})

/** Installation Policy: the Installation-owned mandatory restriction document. */
export interface Policy extends Schema.Schema.Type<typeof Policy> {}

/** The unrestricted Installation Policy. Provisioning still defaults to invite-only. */
export const empty: Policy = {}

/** Effective account provisioning behavior: invite-only unless explicitly opened. */
export const provisioning = (policy: Policy): "open" | "invite-only" => policy.provisioning ?? "invite-only"
