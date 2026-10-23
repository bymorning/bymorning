/** Display form of a Tool's name, capitalised like the built-in labels (Write, Execute). */
export function toolLabel(name: string): string {
  return name.charAt(0).toLocaleUpperCase() + name.slice(1)
}
