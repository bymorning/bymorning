import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { OpenApi } from "effect/unstable/httpapi"
import { format } from "prettier"
import { Api } from "../src/api.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

const openApi = OpenApi.fromApi(Api)
const humanize = (value: string) => {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[. ]/)
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase()))
    .join(" ")
}
const tagNames = new Map(openApi.tags?.map((tag) => [tag.name, humanize(tag.name.split(".").at(-1) ?? tag.name)]))

for (const item of Object.values(openApi.paths)) {
  for (const operation of [item.get, item.post, item.put, item.patch, item.delete]) {
    if (operation === undefined) continue
    if (operation.summary === undefined) {
      operation.summary = humanize(
        operation.operationId
          .split(".")
          .filter((part, index, parts) => !["api", "server", "v2"].includes(part) && part !== parts[index - 1])
          .join("."),
      )
    }
    if (operation.tags !== undefined) {
      const [first, ...rest] = operation.tags
      operation.tags = [tagNames.get(first) ?? first, ...rest.map((tag) => tagNames.get(tag) ?? tag)]
    }
  }
}
for (const tag of openApi.tags ?? []) tag.name = tagNames.get(tag.name) ?? tag.name

const document = await format(JSON.stringify(stabilizeOpenApi(openApi), null, 2), {
  parser: "json",
  printWidth: 120,
})
const target = fileURLToPath(new URL("../openapi.json", import.meta.url))

if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== document) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exitCode = 1
  }
} else {
  await writeFile(target, document)
}
