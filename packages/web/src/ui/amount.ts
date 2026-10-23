export function validateAmount(value: string) {
  if (value === "") return undefined
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
    return "Enter a non-negative amount with at most two decimal places."
  return Number.isFinite(Number(value)) ? undefined : "Enter a finite amount."
}
