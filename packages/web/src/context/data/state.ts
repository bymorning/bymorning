export type DataState =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly refreshedAt?: number }
  | { readonly state: "ready"; readonly refreshedAt: number }
  | { readonly state: "error"; readonly refreshedAt?: number; readonly message: string }
