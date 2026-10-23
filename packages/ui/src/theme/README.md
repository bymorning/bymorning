# Theme

ByMorning ships three synchronously bundled static themes selected by `data-theme` and concrete `data-color-scheme`
attributes. The JSON files in `themes/` are the authoritative definitions, and `tokens.ts` owns the canonical CSS
token inventory.

## Palette Pipeline

All JSON files use the same exact contract: ID, name, registered local fonts, radius, light/dark palettes, and an
optional `components.button` section. Every
palette requires `neutral`, `ink`, `primary`, `success`, `warning`, `error`, `info`, and `accent`. `interactive` is
optional and falls back to `primary`. Palette colors are opaque six-digit `#RRGGBB` seeds; alpha-bearing colors are not
accepted at this input boundary. Button theming is limited to `theme` or pill radius, primary-button state paint and
foreground, theme or no shadow, and a focus-ring color. Paint is either solid or a 0/90/180/270-degree linear gradient
with two to four stops. Colors are opaque hex values or palette references; arbitrary CSS and token overrides are not
accepted. Omitted states retain the canonical theme appearance. State foregrounds are checked at 4.5:1 against rendered
solid colors, canonical overlay/sheen samples, and configured gradients sampled along explicitly rendered sRGB
interpolation. Sampling uses a small conservative buffer above 4.5. The shared button focus ring is checked at 3:1
against the neutral seed. Runtime validation remains the
authoritative boundary for imported JSON; TypeScript's branded palette color prevents unvalidated arbitrary hex strings
in programmatic definitions. Unknown fields and the
former `recipe`, `decisions`, `overrides`, and
`v2Overrides` mechanisms are rejected.

`resolve.ts` has one path for every definition:

1. `primitives.ts` generates neutral and hue ramps from the palette.
2. `mapping.ts` applies one shared light/dark semantic map.
3. `foreground.ts` derives text and icon foregrounds from generated surfaces and `ink`.
4. The primary-button component and font/radius structural layers complete the exact theme-scoped token inventory.

Primitive hue names are the stable historical token vocabulary, not additional theme inputs. Their sources are:

| Primitive ramp | Palette source              |
| -------------- | --------------------------- |
| grey           | `neutral` to `ink`          |
| orange         | `primary`                   |
| green          | `success`                   |
| yellow         | `warning`                   |
| red            | `error`                     |
| blue           | `info`                      |
| purple         | `accent`                    |
| pink           | `accent` shifted 45 degrees |
| cyan           | `interactive ?? primary`    |

Brand backgrounds, accent text/icons, focus borders, and primary buttons therefore respond to `primary`. Status
surfaces respond to their corresponding status ramp. Code interaction uses cyan. Agent solid colors derive from the
generated accent, info, warning, and success ramps, while agent border/background RGBA support values remain fixed
shared semantic mappings.

## Generated CSS

`foundation.ts` owns the shared 38 alpha values and 19 mode avatar values. Generation writes:

- `styles/tokens/colors.css`: shared foundation plus six theme/mode primitive blocks;
- `styles/tokens/theme.css`: six theme/mode semantic/structural blocks and `color-scheme`;
- `styles/fonts.css`: registered local font faces.

Every selected theme and mode exposes 264 unique properties: 38 alpha, 19 avatar, and 207 theme-scoped. Generation is
deterministically ordered by the inventories in `tokens.ts`. Run `bun run theme:generate` after changing definitions or
generation code; `bun run theme:check` and the production build reject drift.

## Runtime

The parser-blocking preload and `ThemeProvider` only select pre-generated CSS through root attributes and update the
root background and `theme-color`. IDs are `bymorning` (Sand), `ink` (Ink), and `paper` (Paper); invalid or missing selection remains Paper
dark. Storage keys, `system` handling, media changes, cross-tab synchronization, fonts, radii, and Shiki references are
unchanged. Definitions and resolvers stay out of the browser import graph, and runtime CSS generation is unsupported.

Palette generation intentionally supersedes exact legacy visual fidelity. Changing generated ramps, shared surface
steps, derived foregrounds, status colors, agent colors, and shadows is accepted; explicit per-theme token snapshots
are not.
