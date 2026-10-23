import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"

/** API-wide translation of request schema failures into the declared error contract. */
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@bymorning/HttpApiSchemaError",
  { error: InvalidRequestError },
) {}
