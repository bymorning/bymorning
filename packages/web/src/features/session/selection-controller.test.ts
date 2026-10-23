/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixtures implement only the exercised session seam. */
import { createRoot, createSignal } from "solid-js"
import { Provider } from "@bymorning/schema/provider"
import { describe, expect, it, vi } from "vitest"

import { modelOptionKey } from "../../utils/model-option"
import { createController } from "./selection-controller"

const alpha = {
  id: "alpha",
  name: "Alpha",
  provider: Provider.Name.make("provider"),
  providerLabel: "Provider",
  variants: ["fast"],
}
const beta = { ...alpha, id: "beta", name: "Beta", variants: [] }

describe("selection controller", () => {
  it("keeps operations separate, rejects unknown variants, and omits default", () => {
    const [detail] = createSignal({
      state: "ready",
      data: { agent: "build", model: { provider: "provider", id: "alpha", variant: "catalog-missing" } },
    })
    const agent = vi.fn()
    const model = vi.fn()
    const controller = createRoot(() =>
      createController({
        data: {
          detail,
          agents: () => [
            { id: "build", name: "Build", mode: "primary", hidden: false },
            { id: "general", name: "General", mode: "subagent", hidden: false },
            { id: "hidden", name: "Hidden", mode: "primary", hidden: true },
          ],
          models: () => [alpha, beta],
        },
        selection: { agent, model, busy: () => () => false, error: () => undefined },
      } as never),
    )

    expect(controller.agent.options()).toEqual([{ key: "build", label: "Build" }])
    expect(controller.variant.options()).toEqual([
      { key: "variant:0", label: "Default" },
      { key: "variant:1", label: "fast" },
    ])
    expect(controller.model.options()).toEqual([
      { key: modelOptionKey(alpha), label: "Alpha", group: "Provider" },
      { key: modelOptionKey(beta), label: "Beta", group: "Provider" },
    ])
    controller.agent.select("build")
    controller.model.select(modelOptionKey(beta))
    expect(agent).toHaveBeenCalledOnce()
    expect(model).toHaveBeenLastCalledWith({ provider: "provider", id: "beta" })
    controller.variant.select("variant:0")
    expect(model).toHaveBeenLastCalledWith({ provider: "provider", id: "alpha" })
  })

  it("exposes model pending once and keeps selection errors separate", () => {
    const controller = createRoot(() =>
      createController({
        data: {
          detail: () => ({ state: "ready", data: { agent: "build", model: { provider: "provider", id: "alpha" } } }),
          agents: () => [],
          models: () => [alpha],
        },
        selection: {
          agent: vi.fn(),
          model: vi.fn(),
          busy: (kind: string) => () => kind === "model",
          error: () => "Selection failed",
        },
      } as never),
    )
    expect(controller.agent.pending()).toBe(false)
    expect(controller.model.pending()).toBe(true)
    expect(controller.model.current()).toBe(modelOptionKey(alpha))
    expect(controller.variant.pending()).toBe(true)
    expect(controller.error()).toBe("Selection failed")
  })

  it("uses collision-free provider and model selection keys", () => {
    expect(modelOptionKey({ provider: Provider.Name.make("a:b"), id: "c" })).not.toBe(
      modelOptionKey({ provider: Provider.Name.make("a"), id: "b:c" }),
    )
  })
})
