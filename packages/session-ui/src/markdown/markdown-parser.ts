import katex from "katex"
import { Marked, type MarkedExtension, type Tokens } from "marked"
import markedShiki from "marked-shiki"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return new Marked(
    {
      renderer: {
        link({ href, title, text }) {
          const titleAttribute = title ? ` title="${title}"` : ""
          return `<a href="${href}"${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`
        },
      },
    },
    mathExtension,
    markedShiki({ highlight }),
  )
}

const inlineMath = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
const blockMath = /^\$\$\n([\s\S]+?)\n\$\$(?:\n|$)/
const mathExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start: (source) => {
        const index = source.indexOf("\\(")
        return index < 0 ? undefined : index
      },
      tokenizer(source) {
        const match = source.match(inlineMath)
        if (!match) return undefined
        return { type: "inlineKatex", raw: match[0], text: match[1]?.trim() ?? "", displayMode: false }
      },
      renderer: renderMath,
    },
    {
      name: "blockKatex",
      level: "block",
      tokenizer(source) {
        const match = source.match(blockMath)
        if (!match) return undefined
        return { type: "blockKatex", raw: match[0], text: match[1]?.trim() ?? "", displayMode: true }
      },
      renderer: renderMath,
    },
  ],
}

function renderMath(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}
