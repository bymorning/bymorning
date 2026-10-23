import { fileMatches } from "./matcher"

const selector = '[data-component="file-link-target"]'

export function decorateFileLinks(root: HTMLElement, paths: ReadonlyArray<string>, open: (path: string) => void) {
  const activate = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : undefined
    const path = target?.dataset.path
    if (!path) return
    event.preventDefault()
    open(path)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") activate(event)
  }
  const update = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("a, button, [data-component=file-link-target], pre")) continue
      nodes.push(node as Text)
    }
    for (const node of nodes) {
      const matches = fileMatches(node.data, paths, "markdown")
      if (!matches.length) continue
      const fragment = document.createDocumentFragment()
      let offset = 0
      for (const match of matches) {
        fragment.append(node.data.slice(offset, match.start))
        const link = document.createElement("span")
        link.dataset.component = "file-link-target"
        link.dataset.path = match.path
        link.setAttribute("role", "link")
        link.tabIndex = 0
        link.textContent = match.path
        fragment.append(link)
        offset = match.end
      }
      fragment.append(node.data.slice(offset))
      node.replaceWith(fragment)
    }
    root.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
      const path = link.getAttribute("href")
      if (path && paths.includes(path)) {
        link.dataset.component = "file-link-target"
        link.dataset.path = path
      }
    })
  }
  root.addEventListener("click", activate)
  root.addEventListener("keydown", keydown)
  return {
    update,
    dispose: () => {
      root.removeEventListener("click", activate)
      root.removeEventListener("keydown", keydown)
    },
  }
}
