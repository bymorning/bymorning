import { InvalidRequestError } from "@bymorning/protocol/errors"
import { SchemaErrorMiddleware } from "@bymorning/protocol/middleware/schema-error"
import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, () =>
  Effect.fail(new InvalidRequestError({ message: "Invalid request" })),
)
