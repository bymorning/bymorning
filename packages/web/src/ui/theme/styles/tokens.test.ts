/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import byMorningJson from "../themes/bymorning.json"
import inkJson from "../themes/ink.json"
import paperJson from "../themes/paper.json"
import { CANONICAL_TOKENS } from "../tokens"
import type { ThemeDefinition, ThemeMode } from "../types"
import { requireTheme } from "../validate"

const root = process.cwd()
const styles = join(root, "src/ui/theme/styles")
const colorsCss = readFileSync(join(styles, "tokens/colors.css"), "utf8")
const themeCss = readFileSync(join(styles, "tokens/theme.css"), "utf8")
const definitions = [requireTheme(byMorningJson), requireTheme(inkJson), requireTheme(paperJson)]

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`Missing CSS block for ${selector}`)
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("\n  }", start))
}

function declarations(body: string) {
  return [...body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;{}]+);/g)].map((match) => [match[1]!, match[2]!.trim()] as const)
}

function themeSelector(theme: ThemeDefinition, mode: ThemeMode) {
  return `:root[data-theme="${theme.id}"][data-color-scheme="${mode}"]`
}

function selected(theme: ThemeDefinition, mode: ThemeMode) {
  const entries = [
    ...declarations(block(colorsCss, ":root")),
    ...declarations(block(colorsCss, `:root[data-color-scheme="${mode}"]`)),
    ...declarations(block(colorsCss, themeSelector(theme, mode))),
    ...declarations(block(themeCss, themeSelector(theme, mode))),
  ]
  return { entries, map: Object.fromEntries(entries) }
}

describe("generated static theme architecture", () => {
  it("defines every canonical token once per combination with every var() reference resolvable", () => {
    for (const definition of definitions) {
      for (const mode of ["light", "dark"] as const) {
        const candidate = selected(definition, mode)
        const names = candidate.entries.map(([name]) => name)
        expect(new Set(names)).toHaveLength(names.length)
        expect(new Set(names)).toEqual(new Set(CANONICAL_TOKENS))
        for (const [, value] of candidate.entries) {
          for (const reference of value.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
            expect(candidate.map[reference[1]!], `${definition.id} ${mode}: ${reference[1]}`).toBeDefined()
          }
        }
      }
    }
  })

  it("defines every production theme reference in every combination", () => {
    const references = new Set<string>()
    for (const path of walk(join(root, "src")).filter((item) => item.endsWith(".css"))) {
      for (const match of readFileSync(path, "utf8").matchAll(
        /var\(--((?:(?:color|shadow|font|button)-|radius)[a-z0-9-]*)/g,
      ))
        references.add(match[1]!)
    }
    for (const definition of definitions) {
      for (const mode of ["light", "dark"] as const) {
        const defined = new Set(selected(definition, mode).entries.map(([name]) => name))
        for (const reference of references)
          expect(defined.has(reference), `${definition.id} ${mode}: ${reference}`).toBe(true)
      }
    }
  })
})

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
