export namespace SidebarLayout {
  export const sessionDefault = 600
  export const sessionMin = 420
  export const sidebarMin = 480
  export const inlineMargin = 0

  export function resolve(preferredSessionWidth: number, available?: number) {
    const sessionMax =
      available === undefined ? Number.POSITIVE_INFINITY : Math.max(sessionMin, available - sidebarMin - inlineMargin)
    const sessionWidth = Math.max(sessionMin, Math.min(preferredSessionWidth, sessionMax))
    return {
      sessionWidth,
      min: sidebarMin,
      max:
        available === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(sidebarMin, available - sessionMin - inlineMargin),
      width: available === undefined ? sidebarMin : Math.max(sidebarMin, available - sessionWidth - inlineMargin),
    }
  }
}
