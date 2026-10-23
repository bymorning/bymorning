export * as Failure from "./failure.js"

import { Schema } from "effect"

/** The retained Workspace runtime for one authenticated caller is unavailable. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()(
  "ToolGateway.UnavailableError",
  {},
) {}
