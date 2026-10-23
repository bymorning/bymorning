import type { ThemeMode, TokenValue } from "./types"

const ref = (name: string): TokenValue => `var(--${name})`

const lightAgentTokens: Record<string, TokenValue> = {
  "color-agent-plan": ref("color-pink-800"),
  "color-agent-plan-border": "rgba(200, 61, 139, 0.20)",
  "color-agent-plan-bg": "rgba(253, 236, 243, 0.10)",
  "color-agent-build": ref("color-blue-800"),
  "color-agent-build-border": "rgba(44, 71, 200, 0.20)",
  "color-agent-build-bg": "rgba(236, 241, 254, 0.10)",
  "color-agent-explore": ref("color-yellow-900"),
  "color-agent-explore-border": "rgba(203, 159, 52, 0.20)",
  "color-agent-explore-bg": "rgba(254, 250, 236, 0.1)",
  "color-agent-review": ref("color-green-800"),
  "color-agent-writer": ref("color-purple-700"),
}

const darkAgentTokens: Record<string, TokenValue> = {
  "color-agent-plan": ref("color-pink-400"),
  "color-agent-plan-border": "rgba(247, 153, 198, 0.20)",
  "color-agent-plan-bg": "rgba(170, 53, 118, 0.05)",
  "color-agent-build": ref("color-blue-300"),
  "color-agent-build-border": "rgba(162, 188, 255, 0.20)",
  "color-agent-build-bg": "rgba(38, 63, 169, 0.05)",
  "color-agent-explore": ref("color-yellow-300"),
  "color-agent-explore-border": "rgba(243, 218, 155, 0.20)",
  "color-agent-explore-bg": "rgba(172, 136, 51, 0.05)",
  "color-agent-review": ref("color-green-300"),
  "color-agent-writer": ref("color-purple-400"),
}

const light: Record<string, TokenValue> = {
  "color-bg-base": ref("color-grey-100"),
  "color-bg-deep": ref("color-grey-300"),
  "color-bg-surface": ref("color-grey-200"),
  "color-bg-surface-raised": ref("color-grey-100"),
  "color-bg-layer-1": ref("color-grey-100"),
  "color-bg-layer-2": ref("color-grey-200"),
  "color-bg-layer-3": ref("color-grey-300"),
  "color-bg-layer-4": ref("color-grey-400"),
  "color-bg-inverse": ref("color-grey-1000"),
  "color-bg-contrast": ref("color-grey-900"),
  "color-bg-button-neutral": ref("color-grey-100"),
  "color-bg-accent": ref("color-orange-600"),
  "color-text-inverse": ref("color-grey-100"),
  "color-text-contrast": ref("color-grey-100"),
  "color-text-accent": ref("color-orange-600"),
  "color-text-accent-hover": ref("color-orange-700"),
  "color-text-code-accent": ref("color-cyan-900"),
  "color-border-muted": ref("color-alpha-dark-8"),
  "color-border-base": ref("color-alpha-dark-10"),
  "color-border-strong": ref("color-alpha-dark-20"),
  "color-border-inverse": ref("color-grey-1000"),
  "color-border-focus": ref("color-orange-500"),
  "color-overlay-hover": ref("color-alpha-dark-4"),
  "color-overlay-pressed": ref("color-alpha-dark-8"),
  "color-overlay-contrast-hover": ref("color-alpha-light-12"),
  "color-overlay-contrast-pressed": ref("color-alpha-light-24"),
  "color-overlay-scrim": ref("color-alpha-dark-40"),
  "color-overlay-depth-top": ref("color-alpha-light-100"),
  "color-overlay-depth-bottom": ref("color-alpha-light-0"),
  "color-success-bg": ref("color-green-100"),
  "color-success-fg": ref("color-green-800"),
  "color-success-border": ref("color-green-300"),
  "color-warning-bg": ref("color-yellow-100"),
  "color-warning-fg": ref("color-yellow-800"),
  "color-warning-border": ref("color-yellow-300"),
  "color-danger-bg": ref("color-red-100"),
  "color-danger-fg": ref("color-red-800"),
  "color-danger-border": ref("color-red-300"),
  "color-info-bg": ref("color-blue-100"),
  "color-info-fg": ref("color-blue-800"),
  "color-info-border": ref("color-blue-300"),
  ...lightAgentTokens,
  "shadow-raised":
    "0px 2px 4px 0px var(--color-alpha-dark-4), 0px 1px 2px -1px var(--color-alpha-dark-8), 0px 0px 0px 0.5px var(--color-alpha-dark-12), 0px 0px 0px 0px var(--color-alpha-dark-0)",
  "shadow-floating":
    "0px 8px 16px 0px var(--color-alpha-dark-4), 0px 4px 8px 0px var(--color-alpha-dark-8), 0px 0px 0px 0.5px var(--color-alpha-dark-12), 0px 0px 0px 0px var(--color-alpha-dark-0)",
  "shadow-overlay":
    "0px 16px 32px 0px var(--color-alpha-dark-4), 0px 8px 16px 0px var(--color-alpha-dark-8), 0px 0px 0px 0.5px var(--color-alpha-dark-12), 0px 0px 0px 0px var(--color-alpha-dark-0)",
  "shadow-button-neutral":
    "0px 1px 1.5px 0px var(--color-alpha-dark-10), 0px 0px 0px 0.5px var(--color-alpha-dark-14), 0px 0px 0px 0px var(--color-alpha-dark-0)",
  "shadow-button-primary":
    "0px 1px 1.5px 0px var(--color-alpha-dark-20), 0px 0px 0px 0.5px var(--color-grey-800), inset 0px 1px 2px 0px var(--color-alpha-light-14), inset 0px -1px 2px 0px var(--color-alpha-dark-6), 0px 0px 0px 0px var(--color-alpha-dark-0)",
  "shadow-element": "0px 0.5px 0.5px 0px var(--color-alpha-dark-40)",
  "shadow-switch-off":
    "inset 0px 1px 1px 0px var(--color-alpha-dark-8), inset 0px 0.5px 0.5px 0px var(--color-alpha-dark-8), inset 0px 0px 0px 0.5px var(--color-alpha-dark-10)",
  "shadow-switch-on":
    "inset 0px 2px 2px 0px var(--color-alpha-dark-10), inset 0px 1px 1px 0px var(--color-alpha-dark-10), inset 0px 0px 0px 0.5px var(--color-alpha-dark-20)",
  "color-illustration-layer-1": ref("color-grey-300"),
  "color-illustration-layer-2": ref("color-grey-400"),
  "color-illustration-layer-3": ref("color-grey-500"),
}

const dark: Record<string, TokenValue> = {
  "color-bg-base": ref("color-grey-1000"),
  "color-bg-deep": ref("color-grey-1200"),
  "color-bg-surface": ref("color-grey-900"),
  "color-bg-surface-raised": ref("color-grey-800"),
  "color-bg-layer-1": ref("color-grey-1000"),
  "color-bg-layer-2": ref("color-grey-900"),
  "color-bg-layer-3": ref("color-grey-800"),
  "color-bg-layer-4": ref("color-grey-700"),
  "color-bg-inverse": ref("color-grey-100"),
  "color-bg-contrast": ref("color-grey-700"),
  "color-bg-button-neutral": ref("color-alpha-light-6"),
  "color-bg-accent": ref("color-orange-600"),
  "color-text-inverse": ref("color-grey-1000"),
  "color-text-contrast": ref("color-grey-100"),
  "color-text-accent": ref("color-orange-400"),
  "color-text-accent-hover": ref("color-orange-300"),
  "color-text-code-accent": ref("color-cyan-400"),
  "color-border-muted": ref("color-alpha-light-8"),
  "color-border-base": ref("color-alpha-light-10"),
  "color-border-strong": ref("color-alpha-light-20"),
  "color-border-inverse": ref("color-grey-100"),
  "color-border-focus": ref("color-orange-500"),
  "color-overlay-hover": ref("color-alpha-light-6"),
  "color-overlay-pressed": ref("color-alpha-light-10"),
  "color-overlay-contrast-hover": ref("color-alpha-dark-24"),
  "color-overlay-contrast-pressed": ref("color-alpha-dark-40"),
  "color-overlay-scrim": ref("color-alpha-dark-60"),
  "color-overlay-depth-top": ref("color-alpha-light-100"),
  "color-overlay-depth-bottom": ref("color-alpha-light-0"),
  "color-success-bg": ref("color-green-1200"),
  "color-success-fg": ref("color-green-500"),
  "color-success-border": ref("color-green-900"),
  "color-warning-bg": ref("color-yellow-1200"),
  "color-warning-fg": ref("color-yellow-500"),
  "color-warning-border": ref("color-yellow-900"),
  "color-danger-bg": ref("color-red-1200"),
  "color-danger-fg": ref("color-red-500"),
  "color-danger-border": ref("color-red-900"),
  "color-info-bg": ref("color-blue-1200"),
  "color-info-fg": ref("color-blue-500"),
  "color-info-border": ref("color-blue-900"),
  ...darkAgentTokens,
  "shadow-raised":
    "0px 2px 4px 0px var(--color-alpha-dark-30), 0px 1px 2px 0px var(--color-alpha-dark-30), 0px 0px 0px 0.5px var(--color-alpha-light-16), 0px -0.5px 0px 0px var(--color-alpha-light-6)",
  "shadow-floating":
    "0px 8px 16px 0px var(--color-alpha-dark-30), 0px 4px 8px 0px var(--color-alpha-dark-30), 0px 0px 0px 0.5px var(--color-alpha-light-16), 0px -0.5px 0px 0px var(--color-alpha-light-6)",
  "shadow-overlay":
    "0px 16px 32px 0px var(--color-alpha-dark-30), 0px 8px 16px 0px var(--color-alpha-dark-30), 0px 0px 0px 0.5px var(--color-alpha-light-16), 0px -0.5px 0px 0px var(--color-alpha-light-6)",
  "shadow-button-neutral":
    "0px 1px 2px 0px var(--color-alpha-dark-40), 0px 0px 0px 0.5px var(--color-alpha-light-20), 0px -0.5px 0px 0px var(--color-alpha-light-10)",
  "shadow-button-primary":
    "0px 1px 2px 0px var(--color-alpha-dark-40), 0px 0px 0px 0.5px var(--color-alpha-light-40), inset 0px 0px 0px 0px var(--color-alpha-light-0), inset 0px 0px 0px 0px var(--color-alpha-light-0), 0px -0.5px 0px 0px var(--color-alpha-light-30)",
  "shadow-element": "0px 0.5px 0.5px 0px var(--color-alpha-dark-40)",
  "shadow-switch-off":
    "inset 0px -0.5px 0px 0px var(--color-alpha-light-10), inset 0px 0px 0px 0px var(--color-alpha-light-0), inset 0px 0px 0px 0.5px var(--color-alpha-light-16)",
  "shadow-switch-on":
    "inset 0px -0.5px 0px 0px var(--color-alpha-light-10), inset 0px 0px 0px 0px var(--color-alpha-light-0), inset 0px 0px 0px 0.5px var(--color-alpha-light-16)",
  "color-illustration-layer-1": ref("color-grey-900"),
  "color-illustration-layer-2": ref("color-grey-800"),
  "color-illustration-layer-3": ref("color-grey-700"),
}

export function mapSemantics(mode: ThemeMode): Record<string, TokenValue> {
  return mode === "dark" ? dark : light
}
