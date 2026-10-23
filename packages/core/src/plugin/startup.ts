export * as PluginStartup from "./startup.js"

import type { App } from "@bymorning/plugin/app"
import { Context } from "effect"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { tags } from "@bymorning/util/effect/app-node"

/** Installation-selected Plugin boot options; never read from persisted Workspace Config. */
export interface Options {
  readonly app: App
  readonly directory?: string
  readonly installPackage?: boolean
}

/** Private Plugin owner startup declaration, bound once by Plugin.configured. */
export class Service extends Context.Service<Service, Options>()("@bymorning/core/PluginStartup") {}

export const node = LayerNode.unbound(Service, tags.values.workspace)
