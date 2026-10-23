/** Shared Toolkit registration helpers. */
export const ToolkitNamespace = "toolkit" as const
export const McpNamespace = "toolkit.mcp" as const
export const IntegrationNamespace = "toolkit.integration" as const
export const PolicyNamespace = "toolkit.policy" as const

export const operational = (permission: string, namespace: string) => ({
  namespace,
  permission,
  gateway: true as const,
  pinned: true as const,
})
