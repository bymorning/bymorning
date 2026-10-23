import { Reference } from "@bymorning/core/reference"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Workspace reference catalog endpoint implementation. */
export const ReferenceHandler = HttpApiBuilder.group(Api, "api.reference", (handlers) =>
  handlers.handle("reference.list", () => Reference.Service.use((reference) => reference.list())),
)
