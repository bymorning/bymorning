import { createMemo, createSignal, For } from "solid-js"
import { useI18n } from "../context/i18n"

import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import "./file-tree.css"

export interface FileTreeProps {
  readonly paths: ReadonlyArray<string>
  readonly activePath?: string | undefined
  readonly onSelect: (path: string) => void
}

type TreeNode = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly type: "directory" | "file"
  readonly children: ReadonlyArray<TreeNode>
}

type VisibleNode = TreeNode & {
  readonly level: number
  readonly parentId: string | undefined
  readonly position: number
  readonly setSize: number
}

export function FileTree(props: FileTreeProps) {
  const i18n = useI18n()
  const tree = createMemo(() => projectPaths(props.paths))
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [highlightedId, setHighlightedId] = createSignal<string>()
  const rows = new Map<string, HTMLElement>()
  const visibleNodes = new Map<string, VisibleNode>()
  const visible = createMemo(() => flattenVisible(tree(), collapsed(), visibleNodes))
  const currentId = () => {
    const nodes = visible()
    const highlighted = highlightedId()
    if (highlighted && nodes.some((node) => node.id === highlighted)) return highlighted
    const active = nodes.find((node) => node.type === "file" && node.path === props.activePath)
    if (active) return active.id
    return nodes[0]?.id
  }
  const focus = (id: string) => {
    setHighlightedId(id)
    queueMicrotask(() => {
      rows.get(id)?.focus()
      rows.get(id)?.scrollIntoView({ block: "nearest" })
    })
  }
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <div data-component="file-tree" role="tree" aria-label={i18n.t("ui.fileTree.label")}>
      <For each={visible()}>
        {(node) => {
          const expanded = () => node.type === "directory" && !collapsed().has(node.path)
          const activate = () => {
            setHighlightedId(node.id)
            if (node.type === "directory") {
              toggle(node.path)
              return
            }
            props.onSelect(node.path)
          }

          return (
            <button
              ref={(element) => rows.set(node.id, element)}
              type="button"
              role="treeitem"
              data-slot="file-tree-row"
              data-node-type={node.type}
              data-selected={node.type === "file" && props.activePath === node.path ? "" : undefined}
              data-highlighted={currentId() === node.id ? "" : undefined}
              aria-level={node.level}
              aria-posinset={node.position}
              aria-setsize={node.setSize}
              aria-expanded={node.type === "directory" ? expanded() : undefined}
              aria-selected={node.type === "file" ? props.activePath === node.path : undefined}
              tabindex={currentId() === node.id ? 0 : -1}
              title={node.path}
              style={{ "padding-inline-start": `${4 + (node.level - 1) * 16}px` }}
              onFocus={() => setHighlightedId(node.id)}
              onClick={activate}
              onKeyDown={(event) => {
                const nodes = visible()
                const index = nodes.findIndex((item) => item.id === node.id)
                const next = nodes.at(index + 1)
                const previous = nodes.at(index - 1)
                if (event.key === "ArrowDown" && next) {
                  event.preventDefault()
                  focus(next.id)
                  return
                }
                if (event.key === "ArrowUp" && previous && index > 0) {
                  event.preventDefault()
                  focus(previous.id)
                  return
                }
                if (event.key === "Home" && nodes[0]) {
                  event.preventDefault()
                  focus(nodes[0].id)
                  return
                }
                if (event.key === "End" && nodes.at(-1)) {
                  event.preventDefault()
                  focus(nodes.at(-1)!.id)
                  return
                }
                if (event.key === "ArrowRight" && node.type === "directory") {
                  event.preventDefault()
                  if (collapsed().has(node.path)) {
                    toggle(node.path)
                    return
                  }
                  if (next?.parentId === node.id) focus(next.id)
                  return
                }
                if (event.key === "ArrowLeft") {
                  if (node.type === "directory" && expanded()) {
                    event.preventDefault()
                    toggle(node.path)
                    return
                  }
                  if (node.parentId) {
                    event.preventDefault()
                    focus(node.parentId)
                  }
                  return
                }
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                activate()
              }}
            >
              <For each={Array.from({ length: node.level - 1 })}>
                {(_, index) => (
                  <span data-slot="file-tree-guide" style={{ "inset-inline-start": `${11 + index() * 16}px` }} />
                )}
              </For>
              {node.type === "directory" ? (
                <span data-slot="file-tree-chevron" data-expanded={expanded() ? "" : undefined} aria-hidden="true">
                  <Icon name="chevron-down" />
                </span>
              ) : (
                <span data-slot="file-tree-chevron-spacer" aria-hidden="true" />
              )}
              <span data-slot="file-tree-icons" aria-hidden="true">
                <FileIcon
                  node={{ path: node.path, type: node.type }}
                  expanded={expanded()}
                  data-slot="file-tree-icon-color"
                />
                <FileIcon
                  node={{ path: node.path, type: node.type }}
                  expanded={expanded()}
                  mono
                  data-slot="file-tree-icon-mono"
                />
              </span>
              <span data-slot="file-tree-label">{node.name}</span>
            </button>
          )
        }}
      </For>
    </div>
  )
}

function projectPaths(paths: ReadonlyArray<string>) {
  const root: MutableNode = { name: "", path: "", type: "directory", children: new Map() }

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    let parent = root
    for (const [index, name] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join("/")
      const type = index === parts.length - 1 ? "file" : "directory"
      const id = `${type}:${nodePath}`
      const existing = parent.children.get(id)
      if (existing) {
        parent = existing
        continue
      }
      const node: MutableNode = { name, path: nodePath, type, children: new Map() }
      parent.children.set(id, node)
      parent = node
    }
  }

  const freeze = (node: MutableNode): TreeNode => ({
    id: `${node.type}:${node.path}`,
    name: node.name,
    path: node.path,
    type: node.type,
    children: [...node.children.values()]
      .toSorted((left, right) =>
        left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1,
      )
      .map(freeze),
  })
  return freeze(root).children
}

type MutableNode = {
  readonly name: string
  readonly path: string
  readonly type: "directory" | "file"
  readonly children: Map<string, MutableNode>
}

function flattenVisible(
  tree: ReadonlyArray<TreeNode>,
  collapsed: ReadonlySet<string>,
  cache: Map<string, VisibleNode>,
) {
  const visible: Array<VisibleNode> = []
  const visit = (nodes: ReadonlyArray<TreeNode>, level: number, parentId?: string) => {
    nodes.forEach((node, index) => {
      const cached = cache.get(node.id)
      const item =
        cached &&
        cached.level === level &&
        cached.parentId === parentId &&
        cached.position === index + 1 &&
        cached.setSize === nodes.length
          ? cached
          : { ...node, level, parentId, position: index + 1, setSize: nodes.length }
      cache.set(node.id, item)
      visible.push(item)
      if (node.type === "directory" && !collapsed.has(node.path)) visit(node.children, level + 1, node.id)
    })
  }
  visit(tree, 1)
  return visible
}
