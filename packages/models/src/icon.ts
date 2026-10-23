import { createHash } from "node:crypto"
import { SaxesParser } from "saxes"

interface IconNode {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: Array<IconNode>
}

const elements = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"])
const attributes = new Set([
  "viewBox",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "fill-rule",
  "clip-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
])

export function sanitizeIcon(source: string) {
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) throw new Error("unsafe SVG: input exceeds 64 KiB")
  const stack: Array<IconNode> = []
  const colors = new Set<string>()
  let root: IconNode | undefined
  let nodeCount = 0
  const reject = (message: string): never => {
    throw new Error(`unsafe SVG: ${message}`)
  }
  const parser = new SaxesParser({ xmlns: false })
  parser.on("xmldecl", () => reject("XML declarations are not allowed"))
  parser.on("doctype", () => reject("DOCTYPE is not allowed"))
  parser.on("processinginstruction", () => reject("processing instructions are not allowed"))
  parser.on("cdata", () => reject("CDATA is not allowed"))
  parser.on("text", (text) => {
    if (text.trim() !== "") reject("text nodes are not allowed")
  })
  parser.on("opentag", (tag) => {
    nodeCount++
    if (nodeCount > 2_048) reject("too many elements")
    if (!elements.has(tag.name) || tag.name.includes(":")) reject(`element ${tag.name}`)
    if (Object.keys(tag.attributes).length > 64) reject("too many attributes")
    const values: Record<string, string> = {}
    for (const [name, value] of Object.entries(tag.attributes)) {
      if (name === "xmlns" && tag.name === "svg" && value === "http://www.w3.org/2000/svg") continue
      if (!attributes.has(name) || name.startsWith("on") || name.includes(":")) reject(`attribute ${name}`)
      const normalized = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim()
      if (normalized.length > 32_768) reject(`value too large in ${name}`)
      if (/url\s*\(|(?:https?|data|javascript)\s*:/i.test(normalized)) reject(`external value in ${name}`)
      validateAttribute(name, normalized, reject)
      if (name === "fill" || name === "stroke") {
        if (normalized !== "none" && normalized !== "currentColor") colors.add(normalized.toLowerCase())
      }
      values[name] = normalized
    }
    if (tag.name === "svg") {
      if (root !== undefined || stack.length !== 0) reject("multiple roots")
      const numbers = values.viewBox?.split(/[, ]+/).map(Number)
      if (
        numbers?.length !== 4 ||
        numbers.some((value) => !Number.isFinite(value)) ||
        numbers[2] <= 0 ||
        numbers[3] <= 0
      ) {
        reject("invalid viewBox")
      }
      values.viewBox = numbers.map((value) => (Object.is(value, -0) ? "0" : String(value))).join(" ")
      delete values.width
      delete values.height
      values.xmlns = "http://www.w3.org/2000/svg"
    }
    const node = { name: tag.name, attributes: values, children: [] }
    if (stack.length > 0) stack.at(-1)!.children.push(node)
    else root = node
    stack.push(node)
  })
  parser.on("closetag", () => stack.pop())
  parser.write(source).close()
  if (root === undefined || root.name !== "svg") reject("missing svg root")
  if (colors.size > 1) reject("multicolor logo")

  const render = (node: IconNode): string => {
    const renderedAttributes = Object.entries(node.attributes)
      .map(
        ([name, value]) =>
          [name, (name === "fill" || name === "stroke") && value !== "none" ? "currentColor" : value] as const,
      )
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => ` ${name}="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`)
      .join("")
    if (node.children.length === 0) return `<${node.name}${renderedAttributes}/>`
    return `<${node.name}${renderedAttributes}>${node.children.map(render).join("")}</${node.name}>`
  }
  const svg = render(root as IconNode)
  return { svg, digest: createHash("sha256").update(svg).digest("hex") }
}

function validateAttribute(name: string, value: string, reject: (message: string) => never) {
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
  const finiteNumber = (candidate: string) => number.test(candidate) && Number.isFinite(Number(candidate))
  if (["cx", "cy", "x", "y", "x1", "x2", "y1", "y2"].includes(name) && !finiteNumber(value)) {
    reject(`invalid number in ${name}`)
  }
  if (["r", "rx", "ry", "width", "height", "stroke-width", "stroke-miterlimit"].includes(name)) {
    if (!finiteNumber(value) || Number(value) < 0) reject(`invalid non-negative number in ${name}`)
  }
  if (["opacity", "fill-opacity", "stroke-opacity"].includes(name)) {
    if (!finiteNumber(value) || Number(value) < 0 || Number(value) > 1) reject(`invalid opacity in ${name}`)
  }
  if (name === "d") validatePath(value, reject)
  if (name === "points") {
    const values = value.split(/[\s,]+/).filter(Boolean)
    if (values.length < 2 || values.length % 2 !== 0 || values.some((item) => !finiteNumber(item))) {
      reject("invalid points geometry")
    }
  }
  if (name === "transform") {
    const transformNumbers = value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? []
    const remainder = value.replace(
      /(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[\s,]+[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)*\s*\)/gi,
      "",
    )
    if (remainder.trim() !== "" || transformNumbers.some((item) => !finiteNumber(item))) reject("invalid transform")
    const calls = [...value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\(([^)]*)\)/gi)]
    const arities: Readonly<Record<string, ReadonlyArray<number>>> = {
      matrix: [6],
      translate: [1, 2],
      scale: [1, 2],
      rotate: [1, 3],
      skewx: [1],
      skewy: [1],
    }
    for (const call of calls) {
      const count = call[2]!.split(/[\s,]+/).filter(Boolean).length
      if (!arities[call[1]!.toLowerCase()]!.includes(count)) reject("invalid transform arguments")
    }
  }
  if ((name === "fill" || name === "stroke") && !/^(?:none|currentColor|#[a-f0-9]{3,8})$/i.test(value)) {
    reject(`invalid paint in ${name}`)
  }
  if (name === "stroke-linecap" && !/^(?:butt|round|square)$/.test(value)) reject("invalid stroke-linecap")
  if (name === "stroke-linejoin" && !/^(?:arcs|bevel|miter|miter-clip|round)$/.test(value)) {
    reject("invalid stroke-linejoin")
  }
  if ((name === "fill-rule" || name === "clip-rule") && !/^(?:nonzero|evenodd)$/.test(value)) {
    reject(`invalid rule in ${name}`)
  }
}

function validatePath(value: string, reject: (message: string) => never) {
  const tokens = value.match(/[MmZzLlHhVvCcSsQqTtAa]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/g) ?? []
  if (tokens.join("") !== value.replace(/[\s,]+/g, "") || tokens[0]?.toLowerCase() !== "m") {
    reject("invalid path geometry")
  }
  if (tokens.some((token) => !/^[A-Za-z]$/.test(token) && !Number.isFinite(Number(token)))) {
    reject("non-finite path geometry")
  }
  const arity: Readonly<Record<string, number>> = { m: 2, z: 0, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++]!
    if (!/^[A-Za-z]$/.test(command)) reject("path data must begin with a command")
    const expected = arity[command.toLowerCase()]
    if (expected === undefined) reject("unknown path command")
    const start = index
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index]!)) index++
    const count = index - start
    if ((expected === 0 && count !== 0) || (expected > 0 && (count < expected || count % expected !== 0))) {
      reject(`invalid ${command} path arguments`)
    }
    if (command.toLowerCase() === "a") {
      for (let argument = start; argument < index; argument += expected) {
        if (Number(tokens[argument]) < 0 || Number(tokens[argument + 1]) < 0) reject("invalid arc radius")
        if (tokens[argument + 3] !== "0" && tokens[argument + 3] !== "1") reject("invalid arc large-arc flag")
        if (tokens[argument + 4] !== "0" && tokens[argument + 4] !== "1") reject("invalid arc sweep flag")
      }
    }
  }
}
