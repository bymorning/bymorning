export * as SessionGraph from "./graph.js"

import { LayerNode } from "@bymorning/util/effect/layer-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Effect, Layer } from "effect"
import { Actor } from "../actor.js"
import { Agent } from "../agent.js"
import { Audit } from "../audit.js"
import { Bus } from "../bus.js"
import { Catalog } from "../catalog.js"
import { Database } from "../database.js"
import { memberLayer } from "../session.js"
import { SessionExecution } from "./execution.js"
import { SessionPermission } from "./permission.js"
import { Service } from "./service.js"

/** Canonical retained member Session service. */
export const node = makeWorkspaceNode({
  service: Service,
  // Resolve the public entry's binding only during acquisition, after its
  // service tag has initialized.
  layer: Layer.unwrap(Effect.sync(() => memberLayer.pipe(Layer.fresh))),
  deps: [
    Actor.binding,
    SessionExecution.node,
    Agent.node,
    Database.node,
    Audit.node,
    Bus.node,
    LayerNodePlatform.crypto,
    Catalog.node,
  ],
})

/** Acquire Session with its Session-owned Permission projection. */
export const ready = LayerNode.group([node, SessionPermission.node])
