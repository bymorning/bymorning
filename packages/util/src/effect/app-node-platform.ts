// Deep imports: the @effect/platform-node barrel eagerly pulls in undici,
// ioredis, and node:sqlite, which runtimes such as workerd cannot load.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as NodePath from "@effect/platform-node/NodePath"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Crypto, FileSystem, Path } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { makeGlobalNode } from "./app-node.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const crypto = makeGlobalNode({ service: Crypto.Crypto, layer: NodeCrypto.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
export const httpClient = makeGlobalNode({ service: HttpClient.HttpClient, layer: FetchHttpClient.layer, deps: [] })
export const nodeServices = makeGlobalNode({
  name: "@effect/platform-node/NodeServices",
  layer: NodeServices.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
