import { Provider } from "@bymorning/schema/provider"
import { cleanup, fireEvent, render } from "@solidjs/testing-library"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ProviderIcon } from "./provider-icon"
import { getProviderIconAsset, providerIconRegistry } from "./provider-icon-registry"
import { providerIcons } from "./provider-icons.generated"

afterEach(cleanup)

describe("provider icons", () => {
  it("maps every stable provider ID to the exact generated same-origin asset", () => {
    expect(getProviderIconAsset(Provider.OpenAI)).toEqual({
      sourceProvider: "openai",
      render: "mask",
      url: "/assets/provider-icons/openai.5c21ab69b228.svg",
    })
    expect(getProviderIconAsset(Provider.Anthropic)).toEqual({
      sourceProvider: "anthropic",
      render: "mask",
      url: "/assets/provider-icons/anthropic.c674c866fff3.svg",
    })
    expect(getProviderIconAsset(Provider.Fireworks)).toEqual({
      sourceProvider: "fireworks",
      render: "mask",
      url: "/assets/provider-icons/fireworks.9bf4c2ce5bfe.svg",
    })
    expect(getProviderIconAsset(Provider.Google)).toEqual({
      sourceProvider: "google",
      render: "mask",
      url: "/assets/provider-icons/google.f7dd044edc5e.svg",
    })
    expect(getProviderIconAsset(Provider.OpenCode)).toEqual({
      sourceProvider: "opencode",
      render: "mask",
      url: "/assets/provider-icons/opencode.91224d6dab26.svg",
    })
    expect(getProviderIconAsset(Provider.Name.make("amazon-bedrock"))).toEqual({
      sourceProvider: "amazon-bedrock",
      render: "mask",
      url: "/assets/provider-icons/amazon-bedrock.0cf801e17ccf.svg",
    })
    expect(getProviderIconAsset(Provider.Name.make("groq"))).toMatchObject({ sourceProvider: "groq" })
    expect(getProviderIconAsset(Provider.Name.make("openrouter"))).toMatchObject({ sourceProvider: "openrouter" })
    expect(getProviderIconAsset(Provider.Bymorning)).toBeUndefined()
    expect([...providerIconRegistry.values()].every(({ url }) => /^\/assets\/provider-icons\//.test(url))).toBe(true)
    expect(Object.keys(providerIcons)).toHaveLength(163)
  })

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

  it("keeps every generated SVG standalone, browser-decodable, and safe for monochrome masking", async () => {
    for (const { url } of Object.values(providerIcons)) {
      const svg = await readFile(path.join(process.cwd(), "public", url), "utf8")
      expect(svg).toMatch(/^<svg\b[^>]* xmlns="http:\/\/www\.w3\.org\/2000\/svg"(?:\s|>)/)
      expect(svg).toContain('currentColor')
    }
  })

  it("renders sanitized monochrome assets through a theme-colored mask", async () => {
    const styles = await readFile(path.join(process.cwd(), "src", "integration", "provider-icon.css"), "utf8")
    const generatedStyles = await readFile(
      path.join(process.cwd(), "src", "integration", "provider-icons.generated.css"),
      "utf8",
    )

    expect(styles).toContain("background-color: currentColor")
    expect(styles).toContain("mask: var(--provider-icon) center / contain no-repeat")
    expect(styles).not.toMatch(/\bfilter\s*:/)
    expect(generatedStyles).toContain(
      `[data-provider-icon="openai"]{--provider-icon:url("${providerIcons.openai.url}")}`,
    )
  })
})
