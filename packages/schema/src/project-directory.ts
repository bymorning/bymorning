/** Declares the Project Directory contract owned by this module. */
export * as ProjectDirectory from "./project-directory.js"
export * as ProjectDirectorySchema from "./project-directory.js"

import { Schema } from "effect"

/** A validated Project-relative file path. */
export const Path = Schema.String.check(
  Schema.isPattern(/^(?![A-Za-z]:\/)(?!\.{1,2}(?:\/|$))[^/\\\0]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\\0]+)*$/),
).pipe(Schema.brand("ProjectDirectory.Path"))

/** A validated Project-relative file path. */
export type Path = typeof Path.Type
