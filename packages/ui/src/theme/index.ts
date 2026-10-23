export { ThemeProvider, useTheme } from "./context"

export namespace Theme {
  export type ID = import("./model").ThemeID
  export type Mode = import("./model").ThemeMode
  export type Scheme = import("./model").ColorScheme
  export type Interface = import("./context").ThemeValue
}
