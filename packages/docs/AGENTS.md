# Documentation instructions

## Prose and style

Match the OpenCode V2 docs voice: short, task-first, example-first. Prefer
https://opencode.ai/v2/docs/ as the layout reference.

- Write for the reader as **you**. Use direct imperatives for procedures and present tense for behavior.
  - Good: “Add the plugin to Workspace configuration.”
  - Bad: “Users will need to add the plugin.”
- Open each page with one or two sentences that state the capability, then show the command, config, or example. Do not add a second intro paragraph.
- Keep prose to one to three sentences per idea. Do not stack paragraphs without a visual break.
- Put the example immediately after the sentence that introduces it. Every subsection that explains a field, syntax, or API must have its own minimal example.
- Lead with the common task. Put edge cases, limitations, and “see also” after the working example.
- Prefer one-word or two-word headings: `Install`, `Connect`, `Config`, `Rules`, `Approvals`. Do not use instructional headings such as “Understand roles” or “Use the authenticated API”.
- Use sentence case for headings; preserve product names and acronyms. The frontmatter title supplies the page heading, so do not add an `#` heading.
- Use `##` for page sections, `###` for subsections or API domains, and `#### Reference` for signatures under an API domain. Do not skip levels.
- Prefer numbered lists over `<Steps>` for UI procedures. Prefer tables and bullets for independent rules. Keep surrounding prose minimal.
- Prefer active voice and exact verbs: “ByMorning reloads the plugin,” not “the plugin is reloaded.”
- Capitalize domain terms only when they name canonical ByMorning concepts, such as Workspace, Provider, Model, Agent, Session, and Tool. Match source terminology.
- Put identifiers, paths, commands, environment variables, literal values, and short API calls in backticks.
- Link internally with root-relative routes and descriptive text: `[Policy guide](/policies)`. Use full URLs for external sites. Never use “click here.”
- Use Blume components such as `<Tabs>`, `<Callout>`, `<Frame>`, and `<Card>` without imports. Use a callout only for a warning the reader can miss. Do not wrap ordinary notes in callouts.
- Keep `title` short. Keep `description` to one sentence, or omit it when the opening line already states the page.

## Files and navigation

- Put authored pages in `packages/docs/src/`.
- Name the landing page `index.mdx`. Name ordered pages `NN-kebab-case.mdx`, using the next two-digit sequence (`01-`, `02-`, and so on). The numeric prefix controls filesystem order and is removed from the route.
- Start every page with this frontmatter shape:

  ```yaml
  ---
  title: Plugins
  description: Extend ByMorning with hooks, transforms, tools, and durable state.
  ---
  ```

- Keep `title` short. Make `description` one sentence that states the page's outcome or scope.
- Do not register ordinary pages manually. `blume.config.ts` sets `content.root` to `./src/`, and Blume derives the sidebar and routes from the filesystem. Edit `navigation.tabs` only for a top-level tab such as the generated `/api` reference.

## Code examples

- Make every example copy-pasteable: include required imports, setup, and realistic values unless the surrounding example already establishes them.
- Put Promise APIs first. Add Effect as a secondary example only when it helps Effect users; in tabs, order them `Promise`, then `Effect`.
- Use precise fence languages (`ts`, `jsonc`, `bash`, `sh`, or `text`). Add a title when the filename or configuration target matters:

  ````md
  ```ts title="plugin/example.ts"
  import { Plugin } from "@bymorning/plugin"
  ```
  ````

- Lead with the smallest working example, then explain lifecycle, constraints, and reference details.
- For API sections, use this order: short capability statement, working example, important behavior, then `#### Reference` with a focused `ts` signature block. Do not paste unrelated implementation types.
- Verify examples against the actual exports and types in `packages/plugin` and their implementation in `packages/core`. Never infer or invent method, option, event, or error names.

## Accuracy

- Verify every API claim against source before writing. Types establish the public contract; implementations establish runtime behavior.
- Trace plugin claims through files such as `packages/plugin/src/promise/plugin.ts`, the relevant domain module under `packages/plugin/src/`, and `packages/core/src/plugin/host.ts`. Follow deeper runtime code when the host delegates behavior.
- Check generated HTTP claims against `packages/protocol/openapi.json` and the implementing server route. Do not treat an old docs page as authoritative.
- State limitations and defaults explicitly when they affect user decisions. Remove claims you cannot verify.

## Verification

- Run commands from `packages/docs`, never the repository root:

  ```bash
  bun typecheck
  bun run build
  ```

- If `blume dev` is running, keep its runtime and `dist/` untouched:

  ```bash
  bun run build -- --isolated
  ```

- Check the rendered page at `http://localhost:4321/<page>` (for example, `http://localhost:4321/plugins`). Confirm the title, code blocks, components, links, sidebar order, and mobile wrapping.
