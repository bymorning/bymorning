/**
 * Process bindings shared by the Core integration suites.
 *
 * The Vitest setup file clones one migrated database per test file and publishes
 * it as DATABASE_URL before the file's imports run; `Database.configured` reads
 * that URL. The remaining host-selected seams (Audit, Storage, Cipher) receive
 * the same ephemeral adapters the focused suites already use, so any Core node
 * graph compiles here exactly as it does under the Application.
 */
import { Audit } from "@bymorning/core/audit"
import { Cipher } from "@bymorning/core/cipher"
import { Database } from "@bymorning/core/database"
import { Storage } from "@bymorning/core/storage"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { layer as cipherLayer } from "../fixtures/cipher.js"
import { layer as storageLayer } from "../fixture/storage.js"

/** Host adapter bindings for every unbound process seam a Core node may reach. */
export const bindings: LayerNode.Replacements = [
  Database.node.replace(Database.configured),
  Audit.node.replace(Audit.makeNode({ database: Database.node })),
  Storage.node.replace(storageLayer),
  Cipher.node.replace(cipherLayer),
]

/** Compile a Core graph against this file's database and the test host adapters. */
export const compile = <A, E>(root: LayerNode.Graph<A, E>, replacements: LayerNode.Replacements = []) =>
  LayerNode.compile(root, { replacements: [...bindings, ...replacements] })

/** This file's cloned database as a closed Layer. */
export const database = compile(Database.node)
