import { Provider } from "@bymorning/schema/provider"
import { cleanup, fireEvent, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"

import { ProviderIcon } from "./provider-icon"
import { providerIcons } from "./provider-icons.generated"

afterEach(cleanup)

describe("provider icons", () => {
  it("renders canonical assets and a neutral custom-provider fallback", () => {
    const custom = Provider.Name.make("custom")
    const result = render(() => (
      <>
        <ProviderIcon provider={Provider.OpenAI} />
        <ProviderIcon provider={Provider.Google} />
        <ProviderIcon provider={Provider.OpenCode} />
        <ProviderIcon provider={Provider.Fireworks} />
        <ProviderIcon provider={Provider.Name.make("amazon-bedrock")} />
        <ProviderIcon provider={Provider.Name.make("groq")} />
        <ProviderIcon provider={custom} />
      </>
    ))
    const icons = result.container.querySelectorAll('[data-slot="provider-icon"]')

    expect(icons).toHaveLength(7)
    expect(icons[0]).toHaveAttribute("data-provider-icon-kind", "canonical")
    expect(icons[0]).toHaveAttribute("data-provider-icon", "openai")
    expect(icons[0]?.querySelector('[data-slot="provider-icon-mark"]')).toBeInTheDocument()
    expect(icons[0]?.querySelector("img")).toHaveAttribute("src", providerIcons.openai.url)
    expect(icons[1]?.querySelector("img")).toHaveAttribute("src", providerIcons.google.url)
    expect(icons[2]?.querySelector("img")).toHaveAttribute("src", providerIcons.opencode.url)
    expect(icons[3]?.querySelector("img")).toHaveAttribute("src", providerIcons.fireworks.url)
    expect(icons[4]?.querySelector("img")).toHaveAttribute("src", providerIcons["amazon-bedrock"].url)
    expect(icons[5]?.querySelector("img")).toHaveAttribute("src", providerIcons.groq.url)
    fireEvent.error(icons[5]!.querySelector("img")!)
    expect(icons[5]).toHaveAttribute("data-provider-icon-kind", "generic")
    expect(icons[5]?.querySelector("img")).toBeInTheDocument()
    expect(icons[5]?.querySelector('[data-slot="provider-icon-mark"]')).not.toBeInTheDocument()
    expect(icons[5]?.querySelector("svg")).toBeInTheDocument()
    expect(icons[6]).toHaveAttribute("data-provider-icon-kind", "generic")
    expect(icons[6]).not.toHaveAttribute("data-provider-icon")
    expect(icons[6]?.querySelector("img")).not.toBeInTheDocument()
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true")
  })
})
