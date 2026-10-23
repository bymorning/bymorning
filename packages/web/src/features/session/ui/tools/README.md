# Tool rendering and icons

`tool-icon.tsx` maps tool names to the shared `ui/components/icon.tsx` sprite.
Icons inherit theme color (`currentColor`) and are decorative; accessible labels
come from the existing tool titles, summaries, and status text.

## Dispatch and state combinations

| Render path                                 | Tools / conditions                                                                                | States and presentation                                                                                                                               | Icon                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ContextTool`                               | `read`, `list`, `glob`, `grep`                                                                    | Running, succeeded, interrupted, stopped; output disclosure when available                                                                            | Read: `file-read`; list: `central-folder-open`; glob/grep: `central-search` |
| `FileTool` through `WriteTool` / `EditTool` | Valid `write` / `edit` input                                                                      | Running, succeeded, interrupted, stopped; content/diff previews and diagnostics                                                                       | `file-edit`; file-type icons remain inside file details                     |
| `GenericTool` for invalid file input        | `write` / `edit` without valid dedicated input                                                    | Same non-failure states; generic arguments and output                                                                                                 | `file-edit`                                                                 |
| `ShellTool`                                 | `shell`                                                                                           | Running, succeeded, interrupted, stopped; command and terminal output                                                                                 | `console`                                                                   |
| `ExecuteTool`                               | `execute`                                                                                         | Running, succeeded, interrupted, stopped; code/path and output                                                                                        | `console`                                                                   |
| `SkillTool`                                 | `skill`, with or without a resolved name                                                          | Running, succeeded, interrupted, stopped; inline row, no output disclosure                                                                            | `central-agent-skills`                                                      |
| `SidebarTool`                               | `sidebar`                                                                                         | Running, succeeded; label reflects opened/closed/showing a path, with a button to open the shown file                                                 | `sidebar-right`                                                             |
| `SubagentTool`                              | `subagent`                                                                                        | Input streaming: compact delegating row; running: loader; succeeded: completed or background-running child; failed/interrupted/stopped: terminal text | Loader while pending; `central-agents` otherwise                            |
| `GenericTool`                               | `websearch`, `webfetch`                                                                           | All non-failure states; query/URL summary and optional output                                                                                         | `web`                                                                       |
| `GenericTool`                               | `patch`, `apply_patch`                                                                            | All non-failure states; generic arguments and output                                                                                                  | `file-edit`                                                                 |
| `GenericTool`                               | Legacy `task`                                                                                     | All non-failure states; generic arguments and output                                                                                                  | `central-agents`                                                            |
| `QuestionTool`                              | Terminal `question`                                                                               | Succeeded with answers: question → answer summary; otherwise falls back to `GenericTool`; failed calls use `ToolErrorCard`                            | `central-sessions`                                                          |
| `GenericTool`                               | Unknown, plugin, or MCP tool names                                                                | All non-failure states; generic arguments and output                                                                                                  | `central-toolbox`                                                           |
| `ToolErrorCard`                             | Failed calls, except renderers that own failure handling (`subagent`)                             | Collapsed/expanded error details and copy action                                                                                                      | `circle-ban-sign`                                                           |
| `ContextToolGroup`                          | Adjacent `read`, `list`, `glob`, `grep` calls; successful reads with loaded files stay standalone | Running/succeeded mixtures; collapsed summary or expanded per-tool rows                                                                               | Search icon on group; each row uses its tool's mapping                      |
| `FileToolGroup`                             | Adjacent `edit` or `patch` calls, grouped separately by name                                      | Running/succeeded; locked-open group with per-file accordion disclosure                                                                               | `file-edit` on group; file-type icons on file rows                          |
| Projection-hidden                           | Running `question`; all `todowrite` calls                                                         | No transcript tool card                                                                                                                               | No visible icon                                                             |
| Permission UI                               | Permission requests                                                                               | Independent idle, pending-response, and response-error states                                                                                         | Separate from tool-card dispatch                                            |

`ToolDisplay` selects failure handling before renderer dispatch. Custom registered
renderers own their presentation. Tool groups bypass `ToolDisplay`, so their
headers and context rows explicitly use the same icon mapping. Opening a card
does not change its operation icon. Subagent navigation can render a link or a
non-link card, with the same icon/loading treatment in either case.

## Coverage added beyond the supplied SVGs

- File search and directory listing use matching existing outlined icons.
- Web fetch shares the supplied web-search globe.
- Write and patch calls share the supplied edit document.
- Skill and subagent calls use the existing book and agent icons.
- Unknown/plugin/MCP calls have a neutral connection fallback.
- Failure cards now have a real `circle-ban-sign` sprite entry; previously the
  missing name silently fell back to the plus icon.

The existing `src/prototypes/tool-ui/fixtures.ts` catalog exercises representative
standalone, grouped, and permission render paths. `timeline/projection.ts` is the
authority for visibility: its current rule hides only running questions, even
though the prototype's hidden-question fixture describes all questions as hidden.

## Verification (2026-09-07)

- Web and application-fixture TypeScript checks passed.
- Tool renderer, group, and prototype tests: 63 passed.
- All 16 name mappings reference registered sprite icons.
- The transcript benchmark ran against a production Vite build served by an
  isolated preview server, before and after the change (five runs per mode).

| Median metric           |      Before |       After |
| ----------------------- | ----------: | ----------: |
| Paced P95 latency       |     16.5 ms |     16.5 ms |
| Burst P95 latency       |     20.1 ms |     20.2 ms |
| Paced wall time         | 10,113.7 ms | 10,113.9 ms |
| Burst wall time         |     59.4 ms |     58.6 ms |
| Paced task duration     |    0.9698 s |    0.9026 s |
| Burst task duration     |   0.04146 s |   0.04267 s |
| Long tasks, either mode |           0 |           0 |

Event counts and checksums match; mounted-row limits and DOM-identity assertions
passed in both runs. Local raw artifacts: `/tmp/opencode/tool-icons-before.json`
and `/tmp/opencode/tool-icons-after.json`.
