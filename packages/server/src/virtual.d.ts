interface ImportMeta {
  /** Replaced with true by the application bundle build. */
  readonly bundled?: boolean
}

declare module "virtual:bymorning-assets" {
  const assets: {
    readonly web: string
    readonly migrations: string
  }
  export default assets
}
