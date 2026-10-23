type Execute = (input: any, context: { permission: (request: unknown) => Promise<void> }) => Promise<unknown>

export type CapturedTool = {
  execute: Execute
  registration: { name: string; options?: { namespace?: string; permission?: string } }
}

export function capture(plugin: { setup: (context: any) => unknown }) {
  const tools = new Map<string, CapturedTool>()
  let method: any
  let integration: any
  let activeCalls = 0
  let resolveCalls = 0
  let credential: any = {
    type: "oauth",
    methodID: "oauth",
    access: "fixture-access",
    refresh: "fixture-refresh",
    expires: 1,
  }
  const connection = { id: "connection" }
  const setup = plugin.setup({
    options: {},
    integration: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          update: (id: string, update: (integration: any) => void) => {
            integration = { id }
            update(integration)
          },
          method: {
            update: (value: unknown) => {
              method = value
            },
          },
        })
        return { dispose: async () => undefined }
      },
      connection: {
        active: async () => {
          activeCalls++
          return connection
        },
        resolve: async () => {
          resolveCalls++
          return credential
        },
      },
      oauth: {
        callback: {
          register: async () => {
            throw new Error("OAuth callback is not registered in this fixture")
          },
        },
      },
    },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          namespace: () => undefined,
          add: (tool: CapturedTool["registration"] & { execute: Execute }) => {
            tools.set(`${tool.options?.namespace}.${tool.name}`, { execute: tool.execute, registration: tool })
          },
        })
        return { dispose: async () => undefined }
      },
    },
  } as any)
  return {
    setup,
    run: async (name: string, input: any, permission: (request: unknown) => Promise<void> = async () => undefined) => {
      await setup
      const tool = tools.get(name)
      if (!tool) throw new Error(`Tool ${name} was not registered`)
      return tool.execute(input, { permission })
    },
    counts: () => ({ active: activeCalls, resolve: resolveCalls }),
    tools: async () => {
      await setup
      return tools
    },
    method: async () => {
      await setup
      return method
    },
    integration: async () => {
      await setup
      return integration
    },
    setCredential: (value: any) => {
      credential = value
    },
  }
}

export async function withFetch(fetcher: typeof fetch, test: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = fetcher
  try {
    await test()
  } finally {
    globalThis.fetch = original
  }
}
