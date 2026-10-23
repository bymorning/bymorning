export function copyToClipboard(
  value: string,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<"copied" | "unavailable" | "failed"> {
  if (!clipboard) return Promise.resolve("unavailable")
  return clipboard.writeText(value).then(
    () => "copied",
    () => "failed",
  )
}
