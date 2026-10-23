import { For, Match, Show, Switch, type JSX } from "solid-js"

import { FileIcon } from "../../../../ui/components/file-icon"
import { Icon } from "../../../../ui/components/icon"
import { IconButton } from "../../../../ui/components/icon-button"
import { Loader } from "../../../../ui/components/loader"
import { Tooltip } from "../../../../ui/components/tooltip"
import { useI18n } from "../../../../ui/context/i18n"
import { useComposer } from "./context"
import "./attachments.css"

export function ComposerAttachments(): JSX.Element {
  const composer = useComposer()
  const language = useI18n()
  const type = (path: string) => language.t(fileType(path))
  // The removed chip takes the focused button with it; keep keyboard users in the strip, or return them to the editor.
  const remove = (id: string, button: HTMLElement) => {
    const group = button.closest<HTMLElement>('[role="group"]')
    const chip = button.closest<HTMLElement>('[data-slot="session-composer-attachment"]')
    const index = Array.from(group?.children ?? []).indexOf(chip as Element)
    composer.attachments.remove(id)
    const remaining = Array.from(
      group?.querySelectorAll<HTMLElement>('[data-slot="session-composer-attachment"] button') ?? [],
    ).filter((candidate) => candidate.isConnected)
    const next = remaining[Math.min(index, remaining.length - 1)]
    if (next) next.focus()
    else composer.restoreFocus()
  }
  return (
    <Show when={composer.attachments.items().length > 0}>
      <div data-component="session-composer-attachments">
        <div
          data-slot="session-composer-attachments-scroll"
          role="group"
          aria-label={language.t("ui.session.composer.attachments")}
        >
          <For each={composer.attachments.items()}>
            {(item) => (
              <div
                data-slot="session-composer-attachment"
                data-state={item.state}
                aria-busy={item.state === "uploading"}
                title={item.path}
              >
                <span data-slot="session-composer-attachment-path">{item.path}</span>
                <span data-slot="session-composer-attachment-subtitle">
                  <FileIcon node={{ path: item.path, type: "file" }} aria-hidden="true" />
                  <Switch fallback={<span>{type(item.path)}</span>}>
                    <Match when={item.state === "uploading"}>
                      <Loader />
                      <span role="status">{language.t("ui.session.composer.uploading", { path: item.path })}</span>
                    </Match>
                    <Match when={item.state === "error"}>
                      <span data-slot="session-composer-attachment-error">
                        {language.t("ui.session.composer.uploadFailed")}
                      </span>
                    </Match>
                  </Switch>
                </span>
                <Show when={item.state !== "uploading"}>
                  <Tooltip
                    value={language.t("ui.session.composer.removeAttachment", { path: item.path })}
                    placement="top"
                  >
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      aria-label={language.t("ui.session.composer.removeAttachment", { path: item.path })}
                      icon={<Icon name="close" size="small" />}
                      onClick={(event) => remove(item.id, event.currentTarget)}
                    />
                  </Tooltip>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div data-slot="session-composer-attachments-fade-start" aria-hidden="true" />
        <div data-slot="session-composer-attachments-fade-end" aria-hidden="true" />
      </div>
    </Show>
  )
}

function fileType(path: string) {
  const name = path.split(/[\\/]/).at(-1) ?? path
  const separator = name.lastIndexOf(".")
  const extension = separator > 0 ? name.slice(separator + 1).toLowerCase() : ""
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "ico", "tif", "tiff"].includes(extension))
    return "ui.session.composer.fileType.image" as const
  if (extension === "pdf") return "ui.session.composer.fileType.pdf" as const
  if (extension === "md" || extension === "mdx") return "ui.session.composer.fileType.markdown" as const
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return "ui.session.composer.fileType.typescript" as const
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "ui.session.composer.fileType.javascript" as const
  if (["json", "jsonc", "jsonl"].includes(extension)) return "ui.session.composer.fileType.json" as const
  if (["txt", "log", "csv", "tsv"].includes(extension)) return "ui.session.composer.fileType.text" as const
  if (
    [
      "astro",
      "c",
      "cc",
      "cpp",
      "cs",
      "css",
      "go",
      "h",
      "hpp",
      "html",
      "java",
      "php",
      "py",
      "rb",
      "rs",
      "scss",
      "sh",
      "svelte",
      "swift",
      "vue",
    ].includes(extension)
  )
    return "ui.session.composer.fileType.source" as const
  return "ui.session.composer.fileType.file" as const
}
