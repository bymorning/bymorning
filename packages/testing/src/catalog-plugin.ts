import { Plugin } from "@bymorning/plugin"
import { Provider } from "@bymorning/schema/provider"

/** Real Workspace contribution: neither this Provider nor its Model has a bundled definition. */
export default Plugin.define({
  id: "test.catalog",
  scope: "workspace",
  configuration: {
    title: "Catalog fixture",
    fields: [
      { key: "endpoint", type: "string", default: "http://fixture.invalid/v1" },
      { key: "upstream", type: "string", default: "custom-upstream" },
    ],
  },
  async setup(context) {
    const { endpoint, upstream } = context.options
    if (typeof endpoint !== "string" || typeof upstream !== "string") throw new Error("Invalid fixture options")
    await context.catalog.transform((editor) => {
      // Upsert before the Provider update exercises the missing-parent path too.
      editor.model.update("fixture-custom", "custom", (model) => {
        model.name = "Plugin Custom"
        model.apiID = upstream
        model.capabilities.tools = true
        model.execution = {
          format: "oa-compat",
          settings: { baseURL: endpoint },
          options: { reasoningEffort: "medium" },
          variants: { alternate: { reasoningEffort: "high" } },
        }
      })
      editor.provider.update("fixture-custom", (provider) => {
        provider.displayName = "Plugin Provider"
        provider.status = "enabled"
        provider.format = "openai"
        provider.api = Provider.API.make("http://provider-default.invalid/v1")
        provider.execution = {
          options: { reasoningEffort: "low" },
          authentication: { type: "key", integration: "deepseek", header: "x-fixture-key" },
        }
      })
      editor.provider.update("deepseek", (provider) => {
        provider.api = Provider.API.make(endpoint)
      })
    })
    // Correlation only: the effective Catalog owns the actual endpoint and upstream ID.
    await context.session.hook("model.request", (input) => {
      input.headers["x-bm-test-session"] = input.sessionID
      input.headers["x-bm-test-purpose"] = input.purpose
    })
  },
})
