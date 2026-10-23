export function closesCommands(event: KeyboardEvent) {
  return (
    event.key === "Escape" ||
    (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g")
  )
}

export function commandDirection(event: KeyboardEvent): -1 | 1 | undefined {
  const ctrlNavigation =
    event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "n" || event.key === "p")
  if (event.key === "ArrowDown" || (ctrlNavigation && event.key === "n")) return 1
  if (event.key === "ArrowUp" || (ctrlNavigation && event.key === "p")) return -1
  return undefined
}
