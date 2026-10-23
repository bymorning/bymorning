import { Option, Schema } from "effect"
import { createStore } from "solid-js/store"

import { createSimpleContext } from "../../context/helper"
import { useWorkspace } from "../../context/workspace"
import { Persist, persisted, safeSyncStorage, type SyncStorage } from "../../runtime/persistence/storage"

export const SIDEBAR_WIDTH_DEFAULT = 256
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 480

const SessionPanelWidth = Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))
const SidebarWidth = Schema.Number.check(Schema.isBetween({ minimum: SIDEBAR_WIDTH_MIN, maximum: SIDEBAR_WIDTH_MAX }))
const LegacyLayout = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    sidebar: Schema.Struct({ opened: Schema.Boolean, width: Schema.optional(SidebarWidth) }),
    session: Schema.Struct({ width: SessionPanelWidth }),
    projectFiles: Schema.Struct({ opened: Schema.Boolean }),
  }),
)

const PersistedLayout = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(2),
    sidebar: Schema.Struct({ opened: Schema.Boolean, width: Schema.optional(SidebarWidth) }),
    session: Schema.Struct({ width: SessionPanelWidth }),
    rightSidebar: Schema.Struct({ opened: Schema.Boolean, tree: Schema.optional(Schema.Boolean) }),
  }),
)

type LayoutState = {
  sidebar: { opened: boolean; width: number }
  session: { width: number }
  rightSidebar: { opened: boolean; tree: boolean }
}

export namespace Layout {
  export interface Interface {
    readonly session: {
      readonly width: () => number
      readonly resize: (width: number) => void
    }
    readonly rightSidebar: {
      readonly opened: () => boolean
      readonly open: () => void
      readonly close: () => void
      readonly toggle: () => void
      /** Whether the file tree is shown beside the preview. */
      readonly tree: () => boolean
      readonly showTree: (shown: boolean) => void
    }
    readonly sidebar: {
      readonly opened: () => boolean
      readonly width: () => number
      readonly resize: (width: number) => void
      readonly open: () => void
      readonly close: () => void
    }
  }
}

function createLayout(props: { readonly storage?: SyncStorage }): Layout.Interface {
  const workspaceID = useWorkspace().current().id
  const storage = safeSyncStorage(props.storage)
  const target = Persist.workspace(workspaceID, "layout")
  migrateLegacyLayout(workspaceID, storage, target.key)
  const layout = createStore<LayoutState>(layoutDefaults())
  // Explicit store typing selects the store overload across the signal/store union.
  // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments
  const [store, setStore] = persisted<LayoutState, typeof layout>(target, layout, {
    storage,
    serialize: (state) => Schema.encodeSync(PersistedLayout)({ version: 2, ...state }),
    deserialize: (encoded) => {
      const document = Option.getOrUndefined(Schema.decodeUnknownOption(PersistedLayout)(encoded))
      if (!document) {
        storage.removeItem(target.key)
        return layoutDefaults()
      }
      const { version: _, ...state } = document
      return {
        ...state,
        sidebar: { ...state.sidebar, width: state.sidebar.width ?? layoutDefaults().sidebar.width },
        rightSidebar: { ...state.rightSidebar, tree: state.rightSidebar.tree ?? layoutDefaults().rightSidebar.tree },
      }
    },
  })
  return {
    session: {
      width: () => store.session.width,
      resize: (width) => setStore("session", "width", width),
    },
    rightSidebar: {
      opened: () => store.rightSidebar.opened,
      open: () => setStore("rightSidebar", "opened", true),
      close: () => setStore("rightSidebar", "opened", false),
      toggle: () => setStore("rightSidebar", "opened", (opened) => !opened),
      tree: () => store.rightSidebar.tree,
      showTree: (shown) => setStore("rightSidebar", "tree", shown),
    },
    sidebar: {
      opened: () => store.sidebar.opened,
      width: () => store.sidebar.width,
      resize: (width) => setStore("sidebar", "width", width),
      open: () => setStore("sidebar", "opened", true),
      close: () => setStore("sidebar", "opened", false),
    },
  }
}

function layoutDefaults(): LayoutState {
  return {
    sidebar: { opened: true, width: SIDEBAR_WIDTH_DEFAULT },
    session: { width: 600 },
    rightSidebar: { opened: false, tree: true },
  }
}

function migrateLegacyLayout(workspaceID: Parameters<typeof Persist.workspace>[0], storage: SyncStorage, key: string) {
  storage.removeItem(`bymorning.workspace:${workspaceID}:home-view`)
  const existing = storage.getItem(key)
  if (existing !== null) {
    const legacy = Option.getOrUndefined(Schema.decodeUnknownOption(LegacyLayout)(existing))
    if (legacy) {
      storage.setItem(
        key,
        Schema.encodeSync(PersistedLayout)({
          version: 2,
          sidebar: { ...legacy.sidebar, width: legacy.sidebar.width ?? SIDEBAR_WIDTH_DEFAULT },
          session: legacy.session,
          rightSidebar: { ...legacy.projectFiles, tree: true },
        }),
      )
    }
    return
  }
  const sidebar = storage.getItem(`bymorning.workspace:${workspaceID}:project-sidebar-open`)
  const width = storage.getItem(`bymorning.workspace:${workspaceID}:session-panel-width`)
  if (sidebar === null && width === null) return

  const defaults = layoutDefaults()
  const state = {
    sidebar: {
      opened: sidebar === "true" ? true : sidebar === "false" ? false : defaults.sidebar.opened,
      width: defaults.sidebar.width,
    },
    session: {
      width: Option.getOrElse(
        Schema.decodeUnknownOption(SessionPanelWidth)(Number(width)),
        () => defaults.session.width,
      ),
    },
    rightSidebar: defaults.rightSidebar,
  }
  const encoded = Schema.encodeSync(PersistedLayout)({ version: 2, ...state })
  storage.setItem(key, encoded)
  if (storage.getItem(key) !== encoded) return
  storage.removeItem(`bymorning.workspace:${workspaceID}:project-sidebar-open`)
  storage.removeItem(`bymorning.workspace:${workspaceID}:session-panel-width`)
}

export const { provider: LayoutProvider, use: useLayout } = createSimpleContext({ name: "Layout", init: createLayout })
