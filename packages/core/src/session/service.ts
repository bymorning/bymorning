import { Context } from "effect"
import type { Interface } from "../session.js"

/** Session service tag isolated from graph construction to keep ESM imports acyclic. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Session") {}
