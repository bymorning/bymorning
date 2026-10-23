/// <reference types="node" />

import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describeImportBoundary } from "../import-boundary.test-helper"

const root = dirname(fileURLToPath(import.meta.url))

describeImportBoundary("Skill list import boundary", root)
