---
description: Break a plan into Bymorning Linear issues, then publish with the to-issue subagent
---

Turn the current plan into Linear issues on the Bymorning team. Guidance: $ARGUMENTS

Work from this conversation. If $ARGUMENTS names a `BYM-n` issue or Linear URL, fetch that issue first and treat it as the parent plan (do not duplicate it). Read `CONTEXT.md` before naming domain concepts.

## Shape

This board files **waves**, not tracer bullets. A parent is the plan. Each child owns one package (or one tightly coupled pair) and is implementable without touching the rest.

- **Team**: Bymorning. **Project**: `agent` (session/product) or `gateway` (LLM Gateway, MCP, deploy, policy).
- **Kind** (exactly one): Feature, Improvement, or Bug.
- **Parent labels**: Plan + kind. **Child labels**: Implement + kind.
- **States**: Todo. Do not assign unless the user names someone.

## Draft

Propose one parent and its children before any Linear write.

Parent title names the capability. Parent body:

```markdown
## Goal

<one or two lines>

## Agreed direction

* <locked decisions only — no open questions disguised as tasks>

## Implementation issues (waves)

Wave 1 (blocking):

* <child title>

Wave 2 (parallel after <blockers>):

* <child title>
```

Each child title is `[Tag] <slice>` where Tag is a short stem from the parent (e.g. `[Share]`). Child body:

```markdown
Parent: <parent>. Wave N (<blocking|parallel after …>). File owner: <packages or files>.

## Own

* <paths or seams this ticket may change>

## Do not touch

<everything else, named if a neighbouring ticket owns it>

## Done when

<checkable verification — package typecheck/test, not "looks good">
```

Show the draft as a numbered list: title, project, kind, wave, blocked by, file owner. Ask whether granularity, waves, project, and kind are right. Iterate until the user approves. Approval is explicit ("yes", "file them", "ship it").

## Publish

After approval, launch the `to-issue` subagent in the **foreground** with the frozen payload: project, kind, create-vs-attach parent, full parent body, and each child (title, body, wave, blockedBy in draft order). The subagent creates the issues; this session does not call Linear create/update.

## Done when

The subagent has returned, every approved issue has a `BYM-n` identifier and URL, and you list them here. If the user rejects the draft, stop with no Linear writes.
