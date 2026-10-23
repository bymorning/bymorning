export * as Lease from "./lease.js"

import type { Workspace } from "@bymorning/schema/workspace"
import { tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Context, type Effect, type Layer, type Scope } from "effect"
import type { Catalog } from "@bymorning/core/catalog"
import type { WorkspaceConfig } from "@bymorning/core/config"
import type { ModelResolver } from "@bymorning/core/model-resolver"
import type { Usage } from "@bymorning/core/usage"
import type { Plugin } from "@bymorning/core/plugin"
import type { UnavailableError } from "./failure.js"

/** Workspace-bound authorities one retained LLM Gateway lease supplies. */
export type Capabilities =
  Catalog.Service | ModelResolver.Service | Usage.Service | WorkspaceConfig.Service | Plugin.Hooks.Service

/** Retained Workspace runtime acquisition and release for LLM Gateway. */
export interface Interface {
  /** Acquire the retained capability graph for one Workspace. */
  readonly acquire: (
    workspaceID: Workspace.ID,
  ) => Effect.Effect<Context.Context<Capabilities>, UnavailableError, Scope.Scope>
  /** Release the retained graph so the next acquisition rebuilds it. */
  readonly invalidate: (workspaceID: Workspace.ID) => Effect.Effect<void>
}

/** Construction input; the host binds it while composing the process graph. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/LLMGateway.Lease") {}

/** Canonical lease declaration, bound by the host like `Actor.binding`; the host's graph may fail while acquiring. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)
