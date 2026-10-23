import type { SkillLibraryEntry } from "./model"

/**
 * Seed content for the Workspace Skill library. Adding an entry creates an
 * ordinary Workspace Skill; the Workspace owns it from that point and can edit
 * or delete it like any other.
 *
 * Every description opens with "Use when" and names what it is not for, because
 * the description is the only text an Agent sees before deciding to load the
 * Skill. Every instruction body teaches a method rather than shipping reference
 * data the model already has.
 */
export const skillLibrary: ReadonlyArray<SkillLibraryEntry> = [
  {
    id: "dashboard",
    category: "analysis",
    name: "Interactive dashboard",
    description:
      "Use when asked for a dashboard, status board, or single-file interactive summary of data. Do not use when the deliverable is one chart, a written report, or a data reduction.",
    instructions: `# Interactive dashboard

Decide what decision the dashboard supports before choosing what to put on it. A dashboard that shows everything supports nothing.

## Before starting

Answer in one sentence each: who looks at this, what decision do they make from it, and what would make them act? Then choose the four to six numbers that drive that decision. Everything else goes in a table below the fold.

Gather the data from the project with \`glob\` and \`read\`. Reduce it first; a dashboard is a presentation layer, not a place to do arithmetic on raw files.

## Choose the mode

**Static, for viewing in the app.** The file preview renders HTML in a sandboxed frame with no script execution and no external requests. So: HTML, inline CSS, and inline SVG only. Interactivity comes from CSS — \`<details>\` for disclosure, \`:target\` for tabs, \`:hover\` for detail. Choose this by default.

**Interactive, for downloading.** Inline vanilla JavaScript and inline JSON in one file, with **zero external requests**: no CDN, no font import, no analytics. It must open from a local disk with no network. Choose this when sorting, filtering, or cross-filtering is genuinely needed, and tell the person it must be downloaded.

## Skeleton

\`\`\`html
<!doctype html>
<meta charset="utf-8">
<title>Project status</title>
<style>
  :root { --ink:#16191d; --muted:#5b6470; --line:#d8dde3; --ok:#1a7f4b; --warn:#a8710a; --bad:#b3261e; }
  body { margin:0; padding:24px; background:#fff; color:var(--ink);
         font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  h1 { font-size:18px; margin:0 0 2px; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:20px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
  .kpi { border:1px solid var(--line); border-radius:6px; padding:12px; }
  .kpi .label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .kpi .value { font-size:24px; font-variant-numeric:tabular-nums; margin-top:4px; }
  .kpi .unit { font-size:13px; color:var(--muted); }
  table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
  th,td { border-bottom:1px solid var(--line); padding:6px 10px; text-align:left; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  td.num { text-align:right; }
  .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
  details summary { cursor:pointer; padding:8px 0; font-weight:600; }
</style>
<h1>Project status</h1>
<p class="sub">Source: data/tasks.csv &middot; 12 records &middot; as of 2026-03-14</p>
<div class="kpis">
  <div class="kpi"><div class="label">Complete</div><div class="value">8<span class="unit"> / 12</span></div></div>
  <div class="kpi"><div class="label">Overdue</div><div class="value bad">2</div></div>
</div>
<table>
  <thead><tr><th>Task</th><th>Owner</th><th>Due</th><th class="num">Complete</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>Draft spec</td><td>A. Chen</td><td>2026-03-10</td><td class="num">100%</td><td class="ok">Done</td></tr>
  </tbody>
</table>
<details><summary>Detail</summary><!-- inline <svg> charts go here --></details>
\`\`\`

For the interactive mode keep this markup and add one \`<script>\` holding the rows as a JSON literal plus sort and filter handlers. No frameworks, no imports.

## Style

Dense, legible, and quiet — an instrument panel, not a marketing page.

- Every number carries a unit, in the column header or beside the value.
- Tabular numerals, right-aligned numeric columns, consistent decimal places.
- Color means status only. Nothing decorative.
- State the source, the record count, and the as-of time on the page.
- Avoid large centered hero blocks, gradient backgrounds, uniform rounded card grids with heavy whitespace, emoji, icon sets, and animated counters. They make a status board look like a landing page and hide the data.

## Output

Use \`write\` for \`dashboards/<name>.html\`. Say which mode you used, what decision it supports, and how to open it.

Then call \`sidebar\` with that path so the dashboard opens beside the conversation. A dashboard exists to be looked at, so this is worth the interruption. Open it once, for the finished file.

## Self-check

- Does every number have a unit and a source?
- If static, does it contain no \`<script>\` and no external URL?
- If interactive, does it make zero network requests?
- Do the tiles answer the decision question, or are they just the easiest numbers to compute?

## Limits

- The in-app preview blocks scripts and external loads. A dashboard needing JavaScript renders blank there; produce it as a download and say so.
- Charts must be inline SVG. No chart libraries.
- Data is inlined at build time, so the as-of timestamp matters.
- Do not invent rows to fill a layout. An empty state is honest.`,
  },
  {
    id: "plot",
    category: "analysis",
    name: "Charts and plots",
    description:
      "Use when asked to plot, chart, graph, or visualize data such as a time series, comparison, distribution, or correlation. Do not use when building a multi-panel dashboard, when the answer is a single number, or when the request is for a diagram of structure or process.",
    instructions: `# Charts and plots

A chart answers one question. Decide the question first; the chart type follows from it.

| Question | Chart |
| --- | --- |
| How did it change over time? | Line, time on x |
| Do two quantities relate? | Scatter, with a fit only if a fit is justified |
| How do discrete cases compare? | Bar |
| Where is the threshold crossed? | Line or bar with the threshold drawn as a dashed line |
| What is the distribution? | Histogram from binned counts |
| What changes at a step? | Step plot |

## Choose the output

- **Quick look in the conversation**, up to roughly 200 points: a Mermaid \`xychart-beta\` block, which renders inline.
  \`\`\`mermaid
  xychart-beta
    title "Monthly revenue"
    x-axis "Month" [1, 2, 3, 4, 5]
    y-axis "Revenue (USD thousands)" 0 --> 120
    line [42, 55, 61, 78, 96]
  \`\`\`
- **Deliverable, or more than a few hundred points**: generate an SVG in the sandbox, print it to stdout, and save it with \`write\` to \`plots/<name>.svg\`. It renders in the file viewer and can go straight into a document. Once written, call \`sidebar\` with that path so the chart opens beside the conversation — a chart is the whole point of the request. Open only the final chart, and only once.

There is no image return path from the sandbox, so the SVG travels through stdout into \`write\`. Keep it compact: downsample to at most about 2000 points and round coordinates to one decimal.

## SVG generator

Standard library only. Adapt the axes, series, and threshold; keep the structure. Run it with \`shell\`, or \`write\` it into the project and use \`run\`.

\`\`\`python
W, H, M = 720, 420, 64            # canvas and margin
DATA = [(0.0, 0.0), (1.0, 480.0)] # replace with (x, y) samples
XLABEL, YLABEL = "Month", "Revenue (USD thousands)"
TITLE = "Monthly revenue - 2024 to 2026"
LIMIT = 83.3                      # threshold line, or None

def downsample(points, cap=2000):
    step = max(1, len(points) // cap)
    return points[::step]

pts = downsample(DATA)
xs = [p[0] for p in pts]
ys = [p[1] for p in pts]
lo_y = min(min(ys), 0 if LIMIT is None else min(ys, default=0))
hi_y = max(max(ys), LIMIT or max(ys))
span_x = (max(xs) - min(xs)) or 1.0
span_y = (hi_y - lo_y) or 1.0
sx = lambda v: M + (v - min(xs)) / span_x * (W - 2 * M)
sy = lambda v: H - M - (v - lo_y) / span_y * (H - 2 * M)

path = " ".join(f"{'M' if i == 0 else 'L'}{sx(x):.1f},{sy(y):.1f}" for i, (x, y) in enumerate(pts))
limit = "" if LIMIT is None else (
    f'<line x1="{M}" y1="{sy(LIMIT):.1f}" x2="{W - M}" y2="{sy(LIMIT):.1f}" '
    f'stroke="#c0392b" stroke-dasharray="6 4"/>'
    f'<text x="{W - M}" y="{sy(LIMIT) - 6:.1f}" text-anchor="end" font-size="12" fill="#c0392b">'
    f'{LIMIT:g}</text>'
)
print(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" \\
font-family="system-ui, sans-serif">
<rect width="{W}" height="{H}" fill="#ffffff"/>
<text x="{M}" y="{M - 28}" font-size="15" font-weight="600">{TITLE}</text>
<line x1="{M}" y1="{H - M}" x2="{W - M}" y2="{H - M}" stroke="#333"/>
<line x1="{M}" y1="{M}" x2="{M}" y2="{H - M}" stroke="#333"/>
<text x="{W / 2}" y="{H - 16}" text-anchor="middle" font-size="12">{XLABEL}</text>
<text x="18" y="{H / 2}" text-anchor="middle" font-size="12" transform="rotate(-90 18 {H / 2})">{YLABEL}</text>
<text x="{M - 8}" y="{sy(hi_y) + 4:.1f}" text-anchor="end" font-size="11">{hi_y:.4g}</text>
<text x="{M - 8}" y="{sy(lo_y) + 4:.1f}" text-anchor="end" font-size="11">{lo_y:.4g}</text>
<text x="{sx(min(xs)):.1f}" y="{H - M + 18}" text-anchor="middle" font-size="11">{min(xs):.4g}</text>
<text x="{sx(max(xs)):.1f}" y="{H - M + 18}" text-anchor="middle" font-size="11">{max(xs):.4g}</text>
{limit}
<path d="{path}" fill="none" stroke="#1f77b4" stroke-width="1.6"/>
</svg>''')
\`\`\`

For a scatter, emit \`<circle>\` elements instead of the path. For a second series, add another path in a distinct color and a small legend. For a second y-axis, scale it separately and label both axes.

## Style

- Axis labels always carry units. A bare "Revenue" is a defect.
- The title says what, and over what period.
- Thresholds and targets are dashed and labelled; the data is solid.
- Say in the caption if you downsampled, filtered, or clipped, and by how much.
- No gradients, shadows, 3-D, or decorative color. Color carries meaning or is not used.
- Do not draw a trend line unless a trend is expected. If you draw one, report its coefficients and fit quality.

## Self-check

- Do both axes have units?
- Does the y-axis range mislead? Do not suppress zero silently.
- Did you state the downsampling?
- Does the chart answer the question that was asked?

## Limits

- The sandbox returns text only. An SVG is printed and then written; a PNG cannot be produced.
- The in-app preview runs no scripts, so a saved chart must be static SVG.
- Do not chart data you have not sanity-checked. A plot of a broken column looks entirely convincing.`,
  },
  {
    id: "data-analysis",
    category: "analysis",
    name: "Analyze a data file",
    description:
      "Use when reducing or interrogating a data file: CSV, TSV, JSON lines, or a delimited log or export. Do not use when the deliverable is only a chart, when writing a narrative report, or when investigating a known incident.",
    instructions: `# Analyze a data file

Predict what the data should look like before you look at it. A reduction that only reports statistics finds nothing; one that compares data against an expectation finds everything.

## Before starting

1. Find the file with \`glob\`. Check its size before reading it whole. For anything large, read the header and first rows, then reduce in the sandbox rather than pulling the file into the conversation.
2. Establish the columns, their units or meaning, and the time origin if there is one. Do not guess a unit from a column name.
3. Write down what you expect each column to contain: ranges, categories, relationships between columns. That expectation is what turns numbers into findings.

## Method

1. **Check the data before the analysis.** Every column, before any statistics:
   - missing, blank, and null values, and how many;
   - malformed rows and rows with the wrong field count;
   - duplicates, including near-duplicates on a key;
   - values outside a plausible range, and values pinned at a boundary;
   - inconsistent formats, encodings, and date parsing;
   - timestamps out of order or with gaps.
   Report these first. A conclusion drawn from a broken column is worse than no conclusion.
2. **Reduce in the sandbox.** Single file, standard library first. Probe before importing anything else:
   \`\`\`python
   import csv, statistics
   rows = list(csv.DictReader(open("data.csv")))
   \`\`\`
   Available without dependencies: counts, mean, median, standard deviation, min and max with their keys, percentiles by sorting, grouping with a dict, a moving average, and a least-squares line fit.
3. **Segment before summarizing.** A statistic over the whole file usually describes nothing. Split by the dimension that matters — time period, category, cohort — and report each.
4. **Compare against the expectation.** For each column report what you expected and what you found. Discrepancies are the result.
5. **Investigate discrepancies, do not average them away.** A group that behaves differently is the finding, not noise to smooth.

## Output

Report in the chat:

- a data-quality summary: rows read, rows usable, and every column with a problem;
- a summary table: column, type, count, distinct, missing, and the statistics that fit its type;
- the segmented result that answers the question asked;
- discrepancies, each with a candidate explanation and the check that would confirm it;
- what you did not check.

Use \`write\` for \`analysis/<name>-summary.md\` and any derived table as \`analysis/<name>-reduced.csv\`. Keep the script at \`analysis/<name>.py\` so the numbers can be regenerated.

Then call \`sidebar\` with the summary path so it opens beside the conversation. Open the summary only — not the reduced table or the script, which exist to be rerun rather than read.

## Self-check

- Did you check for missing, malformed, and duplicate rows before computing statistics?
- Does every reported quantity carry a unit or a clear definition?
- Did you state the expectation you compared against, or only describe the data?
- Does the summary cite rows or keys for each specific claim?

## Limits

- \`read\` handles UTF-8 text only. For a spreadsheet, database, or binary export, ask for a CSV or TSV; do not guess at the contents.
- The sandbox has no network and no third-party packages by default. Embed the data the script needs, or reduce in stages.
- Sandbox output is capped and each run starts fresh. Print summaries, not raw dumps.
- Never infer a missing value, interpolate across a gap, or extend a series beyond its data without saying so.`,
  },
  {
    id: "estimate",
    category: "analysis",
    name: "First-principles estimate",
    description:
      "Use when asked to estimate, size, or judge the feasibility of a quantity where no direct measurement exists: capacity, cost, duration, load, or throughput. Do not use when reviewing an estimate someone else produced, when the number can simply be looked up, or when the question is not quantitative.",
    instructions: `# First-principles estimate

Start from the mechanism, not from a remembered benchmark. A benchmark is a cross-check, never the derivation.

## Before starting

Write down every input in a table: quantity, value, unit, and source — given by the person, read from a named file, recalled from your own knowledge, or assumed. If an input you need is missing, ask for it once and state the assumption you will use if it does not arrive. Do not stall on a missing input you can bound.

## Method

1. **State the question as a relation.** What drives the quantity, and how? Write the expression and define every symbol with its unit.
2. **Check the units resolve** before putting numbers in. If they do not, the relation is wrong; fix it first.
3. **Bound the answer first.** Make a one-line order-of-magnitude estimate with round numbers and record it. This is what you will test the detailed result against.
4. **Compute in the sandbox** whenever the arithmetic has more than two steps. Use \`shell\` for a one-liner, or \`write\` the script and run it with \`run\`. Print intermediate quantities with units so each step is auditable.
5. **Cross-check with a second, independent method.** A different decomposition, a limiting case, or a top-down figure against a bottom-up one. Report both. If they disagree by more than the uncertainty you claim, you do not yet have an answer; find the discrepancy.
6. **Test the limiting cases.** What happens as each driver goes to zero, and to very large? A relation that misbehaves at a limit is missing a term.
7. **Give a range, not a point.** If inputs have no stated uncertainty, run the calculation at plausible low and high values and report the range.
8. **Do a sensitivity pass.** For each assumption, state how much the answer moves if it is wrong. Order the list by influence. This is usually the most useful part of the answer.

## Output

- The answer with units, to a number of significant figures the inputs justify — three at most unless they support more.
- The relation, in KaTeX, with symbols defined.
- The inputs table with a source label for each.
- The independent cross-check and what it gave.
- Assumptions ranked by sensitivity.
- What you did not account for.

Use \`write\` for \`analysis/<topic>.py\` when the person will want to rerun or extend it. Keep short one-off arithmetic in the chat.

If you wrote the script and they asked to see the working, call \`sidebar\` with that path. If the answer and its sensitivity table fit in the chat, leave the sidebar alone.

## Self-check

- Does every number carry a unit and a source label?
- Does the detailed result agree with the order-of-magnitude bound within about 2x?
- Did the second method use a different route, or just repeat the first?
- Are the significant figures honest about the worst input?

## Limits

- Benchmarks, rates, and constants recalled from memory are unverified. Mark them, and where the answer depends on one, say what source should confirm it.
- The sandbox has no network and no third-party packages by default.
- If the question is whether someone else's estimate is right, use the analysis review skill instead.`,
  },
  {
    id: "analysis-review",
    category: "decisions",
    name: "Review an analysis",
    description:
      "Use when asked to check, critique, or sign off on a calculation, model result, analysis document, or quantitative claim that someone else produced. Do not use when producing the analysis yourself, or when reviewing prose for style rather than correctness.",
    instructions: `# Review an analysis

The failure mode of a review is agreement. Reading someone's method first makes you adopt it, so do not read it first.

## Before starting

Collect the claim under review, the inputs it used, and the method or script. Find them with \`glob\` and \`grep\` and open them with \`read\`. Note which of the three you are missing; a review with no stated inputs can only be a plausibility check, and you should say so.

## Method

1. **Reproduce independently, before reading their method.** Take only the stated inputs and the question, and derive your own answer. Record it before you look at how they did it.
2. **Compare the two numbers.** Agreement within the uncertainty is evidence, not proof; both can share a wrong assumption. Disagreement is the start of the review.
3. **Then read their method and diff it against yours**, in order:
   - **Inputs:** values, units, and sources. Is any input assumed where it should be measured?
   - **Unit and scale consistency**, including mixed unit systems, percentages versus fractions, and time bases.
   - **Sign and direction**, including which way an effect pushes the result.
   - **Boundary conditions:** are they the ones the real situation has?
   - **Cases:** which were considered, and which plausible one is absent?
   - **Failure modes:** what the analysis covers and what it does not. An unaddressed mode is the most common real finding.
   - **Conservatism:** is each simplification conservative, and does the stack of them stay conservative? Two can cancel.
   - **Method soundness:** convergence, sample size, selection effects, and whether anything was validated against a known case.
4. **Classify each finding** as exactly one of:
   - **Wrong** — the result changes. Give the corrected value.
   - **Unsupported** — may be right, but nothing shown justifies it. Name the evidence needed.
   - **Optimistic** — the assumption biases the result in the favorable direction. Quantify the bias if you can.
   - **Cosmetic** — presentation or traceability. Do not let these crowd out the first three.
5. **State what would change the conclusion.** A review that does not say what evidence would flip it is an opinion.

## Output

- Your independent result and theirs, side by side with units.
- A findings table: ID, classification, location, description, effect on the result, recommended action.
- An explicit disposition: concur, concur with comments, or do not concur, with the reason in one sentence.
- What you could not review, and why.

Use \`write\` for \`reviews/<subject>-findings.csv\` when there is more than a handful. If you wrote it, call \`sidebar\` with that path so the findings open beside the conversation. If the findings fit in the chat, do not open the sidebar.

## Self-check

- Did you compute your own answer before reading their method?
- Is every finding classified, and is at least one about substance rather than presentation, or have you genuinely found none?
- If you concurred, can you name the specific evidence you relied on?
- If you could not reproduce their result, does the review say so plainly rather than deferring to it?

## Limits

- Do not sign off on what you could not reproduce. Say "not reproduced" and list what is missing.
- A non-UTF-8 document cannot be read. Ask for a text export, or for the inputs and method directly.`,
  },
  {
    id: "trade-study",
    category: "decisions",
    name: "Compare options",
    description:
      "Use when comparing options, vendors, architectures, or approaches and asked for a recommendation: trade study, decision matrix, or options analysis. Do not use when the decision is already made and only needs documenting, or when reviewing a single analysis.",
    instructions: `# Compare options

Define the criteria and the weights before you look at the options. Doing it in the other order produces a matrix that justifies the answer the author already had.

## Method

1. **State the decision and its reversibility.** What is being chosen, by when, and what does it cost to change later? A cheap, reversible decision does not need this process.
2. **Elicit criteria first, from the requirement.** Split them:
   - **Must** — pass or fail. An option failing a must is eliminated and does not enter scoring. Record the elimination; do not score around it.
   - **Want** — scored and weighted.
   Write the criteria and weights down, and state them, before introducing the options.
3. **Justify each weight** in terms of the outcome it serves. Weights with no rationale are the study's main vulnerability.
4. **Define each scoring scale** concretely before scoring. What does a 1 mean, and a 5, for this criterion? A shared undefined scale produces noise.
5. **Score with evidence.** Each score cites a measurement, a document, a vendor datum, or an explicit estimate. Mark estimated scores; they drive the sensitivity study.
6. **Compute two ways:** a weighted sum, and a comparison against a baseline option scored better, same, or worse. When the two disagree, that is the finding — usually one criterion dominates, or the scales are not comparable.
7. **Run sensitivity.** Vary each weight across a plausible range and record where the winner changes. **A winner that flips under a plausible weight change is not a winner** — report it as a tie and say what evidence would break it.
8. **Check what the matrix hides:** switching cost, lock-in, time to value, maintenance burden, hiring and training, and what happens if the option fails late. These are often criteria, not footnotes.
9. **Record dissent.** If someone disagrees, record the position and its basis. A study that erased the dissent is how teams relearn things.

## Output

Use \`write\` for \`trades/<decision>.md\` with the decision statement, must criteria and eliminations, want criteria with weights and rationale, scoring scales, the matrix with evidence per score, both computations, the sensitivity result, the recommendation, dissent, and open items. Put the matrix in \`trades/<decision>.csv\`.

In the chat: the recommendation in one sentence, the margin by which it wins, the weight change that would flip it, and the evidence that would most improve confidence.

Then call \`sidebar\` with the \`.md\` path so the study opens beside the conversation. Open the study, not the matrix CSV.

## Self-check

- Were criteria and weights fixed before the options were scored?
- Does every score cite evidence, or is it marked an estimate?
- Do both computations agree? If not, is the reason explained?
- Did you report the weight change that flips the winner?
- Are eliminated options recorded with the must they failed?

## Limits

- Do not score a criterion you have no evidence for. Mark it unknown and treat it in the sensitivity study.
- Do not invent vendor pricing, lead times, or specifications. Ask, or mark as needing confirmation.
- A comparison supports a decision; it does not make one. Leave the decision with its owner.`,
  },
  {
    id: "review-actions",
    category: "decisions",
    name: "Track review actions",
    description:
      "Use when capturing, dispositioning, or tracking items a review produced: action items, findings, comments, or a burn-down to closure. Do not use when preparing the review material itself, or when investigating an incident.",
    instructions: `# Track review actions

An action item without an owner, a date, and a closure criterion is a note. Capture it as a note or capture it properly; do not pretend.

## Fields

| Field | Rule |
| --- | --- |
| ID | Stable and unique within the review |
| Source | Who raised it, and where |
| Description | The concern, not the proposed fix |
| Area | The discipline or component it belongs to |
| Severity | Blocking / major / minor / editorial |
| Owner | A named person. Never a team, never blank |
| Due | A date. Never "TBD" or "ASAP" |
| Disposition | Open / accepted / rejected / deferred / duplicate |
| Closure evidence | The document, change, or test that closes it, with a path |
| Status | Open / in work / closed |

Keep the concern separate from the fix. An item recorded as its proposed solution cannot be closed by a better one.

## Severity

- **Blocking** — the milestone cannot pass until it is resolved.
- **Major** — must be resolved before the next milestone; affects scope, cost, or schedule.
- **Minor** — should be resolved; no milestone impact.
- **Editorial** — documentation and clarity.

Do not inflate severity to get attention, or deflate it to pass the review. State the basis for blocking items.

## Disposition

Each item gets one, with a reason:

- **Accepted** — the concern stands; an action follows.
- **Rejected** — the concern does not stand; record the evidence showing why. A rejection with no evidence is a deferral.
- **Deferred** — valid but out of scope now; record where it moves to and who agreed.
- **Duplicate** — record the item it merges into.

## Closure

An item closes when its closure evidence exists and the originator agrees. Record both. Closure by assertion — "addressed in the new revision" — is not closure; cite the revision and the specific change.

## Burn-down

Report total by severity, closed by severity, open past due, open with no owner, open with no due date, and items closed without evidence. The last three are the health indicators worth reporting.

## Output

Use \`write\` for \`reviews/<review>-actions.csv\` with one column per field, and \`reviews/<review>-actions.md\` with the burn-down and the blocking items in full. In the chat: counts by severity and status, blocking items with owners and dates, and every item missing an owner, a date, or closure evidence.

Then call \`sidebar\` with the \`.md\` path so the burn-down opens beside the conversation. Open it once, not on every status refresh.

## Self-check

- Does every item have a named individual owner and a real date?
- Is every description the concern rather than a proposed fix?
- Does every closed item cite closure evidence?
- Does every rejection cite the evidence supporting it?

## Limits

- Never invent an owner or a due date. Leave the field empty and list it in the exceptions; an invented owner makes the tracker worse than an empty one.
- Do not silently close an item. Closure needs evidence and originator agreement.
- Do not merge items that merely sound similar.`,
  },
  {
    id: "design-review",
    category: "decisions",
    name: "Design review package",
    description:
      "Use when preparing for or critiquing a design review or milestone review, or assessing whether work is ready to pass a gate. Do not use when tracking the action items a review produced, when comparing options, or when reviewing a single analysis.",
    instructions: `# Design review package

The purpose of a review is to find what the team has stopped seeing. A package that only presents the design wastes the reviewers.

## Before starting

Establish the milestone, the scope, the date, and the audience. Then inventory what exists with \`glob\` and \`grep\`: requirements, analyses, test or validation results, interfaces, risks, and open actions. The gap between what the milestone expects and what exists is the first output.

## What a gate must show

- **Concept** — the need, the requirements, the operating concept, and the top risks. Exit: requirements are agreed and traceable to the need.
- **Preliminary** — an approach that closes: budgets and allocations with margin, interfaces defined, analysis at preliminary depth, a verification plan, risks with mitigations. Exit: the approach will meet the requirements and the remaining work is known.
- **Critical** — mature enough to build: released detail, final analysis with margins, a qualification plan and status, procurement status, and closed interfaces. Exit: it is buildable and will meet the requirements.
- **Readiness** — the article, procedure, environment, instrumentation, safety, and success criteria are ready. Exit: it can run safely and will produce the data needed.

Treat these as the intent behind the gate. When the organization's own criteria are available, follow those and note any difference.

## Method

1. **Audit against the gate.** For each expected element record: present and complete, present but immature, or absent. Absent items are the review's agenda.
2. **Challenge every design choice.** For each major decision: what was the alternative, what drove the choice, and what would change it? A choice with no recorded alternative was not a decision.
3. **Check the budgets close.** Allocation, current estimate, margin, and the maturity of each estimate. A budget with no margin policy is a finding.
4. **Stack the worst case.** Combine tolerances and off-nominal conditions unfavorably. State the combination rule used.
5. **Find the single points of failure** and say which are accepted and why.
6. **Be honest about maturity.** Mark each key claim tested, analyzed, estimated, or assumed. A critical review resting on assumed values is the finding.
7. **List assumptions carried since the last milestone that are still unverified.** These are where programs get hurt.
8. **State readiness plainly:** ready, ready with actions, or not ready, with the specific gaps.

## Package outline

Produce a slide-by-slide outline with a title, the message in one sentence, the content, and speaker notes. Use Mermaid for architecture, sequences, and dependencies:

\`\`\`mermaid
graph LR
  API[API service] -->|REST| WORKER[Worker]
  WORKER --> DB[(Database)]
\`\`\`

Standard flow: purpose and agenda; requirements and changes since last milestone; operating concept; architecture; component detail; budgets with margin; analysis summary with maturity; verification plan and status; interfaces; risks and mitigations; schedule and procurement status; open items; exit-criteria assessment.

## Output

Use \`write\` for \`reviews/<milestone>-package.md\` with the outline and speaker notes, and \`reviews/<milestone>-readiness.csv\` with the audit: criterion, status, evidence path, gap, owner. Report the readiness verdict and top gaps in the chat.

Then call \`sidebar\` with the package path so it opens beside the conversation. The package is the deliverable; open that one, not the readiness CSV.

## Self-check

- Does the audit cite an evidence path for every element marked complete?
- Is every key number labeled tested, analyzed, estimated, or assumed?
- Do the budgets show margin and a margin policy?
- Did you challenge design choices, or only describe them?

## Limits

- Do not mark a criterion complete because a document exists; check it contains what the gate needs.
- Do not invent margins, budget numbers, or release status. Mark unknown and list as a gap.
- This produces a Markdown outline, which is what a deck is built from.`,
  },
  {
    id: "incident-review",
    category: "operations",
    name: "Investigate an incident",
    description:
      "Use when investigating a failure, outage, defect, or unexpected behavior and asked for the cause: root-cause analysis, incident review, or corrective action. Do not use when the cause is already known and only the write-up is needed, or when reviewing a routine result.",
    instructions: `# Investigate an incident

The discipline is falsification. A hypothesis that explains the observation is worthless on its own; it is only useful when it predicts something the others do not.

## Before starting

Establish the observable: what exactly was seen, when, by what instrument, and what was expected instead. "The service failed" is a conclusion. Restate it as the observation: "p99 latency rose from 120 ms to 9 s over 40 seconds starting 03:14 UTC, while request volume was flat."

## Method

1. **Reconstruct the timeline** from logs, metrics, deploys, and operator records. Cite the line or timestamp for every entry. Extend it back to the last known-good state and forward through the response.
2. **Fix the boundary.** What is in scope, what is known good, and what is unexamined? Say which of the three each element is.
3. **Enumerate hypotheses broadly** before judging any. Cover code, configuration, data, dependencies, capacity, environment, instrumentation — the measurement may be the fault — and human factors. Fewer than four usually means you stopped early.
4. **Build the hypothesis matrix. Every hypothesis must make a discriminating prediction** — something true if it is the cause and false if a competitor is:

   | ID | Hypothesis | Discriminating prediction | Evidence for | Evidence against | Status |
   | --- | --- | --- | --- | --- | --- |
   | H1 | Connection pool exhaustion | Pool wait time rises before latency; DB CPU flat | Pool metric at 03:13 | DB CPU also rose | Open |

   A hypothesis with no discriminating prediction cannot be resolved by evidence. Rewrite it or drop it.
5. **Eliminate against evidence, not plausibility.** Mark each supported, refuted, or open, and cite the specific evidence. "Unlikely" is not a status.
6. **Build a fault tree** for the surviving branches:
   \`\`\`mermaid
   graph TD
     TOP["p99 latency 9s at 03:14"] --> A["Requests queueing"]
     TOP --> B["Work per request grew"]
     TOP --> C["Measurement artifact"]
     A --> A1["Pool exhausted"]
     A --> A2["Downstream slow"]
   \`\`\`
7. **Separate the causes.** State the **proximate** cause (the immediate mechanism), the **root** cause (the condition whose removal prevents recurrence), and **contributing** factors. Most investigations stop at proximate and call it root; do not.
8. **If no hypothesis is discriminated, say so.** Output the next test or measurement that would separate the candidates. A named root cause without discriminating evidence is the most expensive output of an investigation.
9. **Define actions:** containment (stops the immediate risk), corrective (removes the root cause), and preventive (catches the class earlier). Each with an owner and a verification method.

## Output

Use \`write\` for \`incidents/<id>-report.md\` with the observation, timeline, boundary, hypothesis matrix, fault tree, causes, actions, and open items. Put the matrix and actions in \`incidents/<id>-matrix.csv\` and \`incidents/<id>-actions.csv\`.

In the chat: the observation, surviving hypotheses with status, the cause statement or why one cannot yet be made, and the immediate containment.

Then call \`sidebar\` with the report path so it opens beside the conversation. Open the report, not the matrix or actions CSVs.

## Self-check

- Is the observation stated as an observation rather than a conclusion?
- Does every hypothesis make a prediction that discriminates it from the others?
- Does every timeline entry cite a source?
- If you named a root cause, what evidence rules out the alternatives? If you cannot answer, do not name one.
- Does each corrective action address the root cause rather than the symptom?

## Limits

- Do not name a root cause to be helpful. "Undetermined; the discriminating test is X" is a correct and valuable answer.
- Do not fill gaps in the timeline by inference. A gap is evidence about the instrumentation.
- Blameless means describing what the system made easy to do wrong, not omitting human actions from the timeline.`,
  },
  {
    id: "procedure",
    category: "operations",
    name: "Write a procedure",
    description:
      "Use when writing, reviewing, or redlining a procedure, runbook, or checklist that someone will execute step by step. Do not use when reporting results after the fact, or when authoring requirements.",
    instructions: `# Write a procedure

Write for the person executing it at 02:00 on their third shift, not for the engineer who designed it. Every step must be executable and verifiable without asking anyone.

## Before starting

Establish what the procedure accomplishes, the starting state it assumes, the tools and access required, the hazards or blast radius, and the data to record. A procedure written without the hazard list will be missing its abort criteria.

## Structure

\`\`\`markdown
# <Name>, rev <n>

## 1. Scope
## 2. Prerequisites
Starting state, access and permissions, prior steps complete, tools installed.
## 3. Tools and access
## 4. Risks and controls
What can go wrong, the blast radius, who to notify, and how to roll back.
## 5. Abort criteria
Each condition, how it is observed, and the action to take.
## 6. Steps
## 7. Afterwards
Return to steady state, cleanup, verification, and where the records go.
## 8. Record
## 9. Sign-off
\`\`\`

Step table, one row per action:

| Step | Action | Expected result | Limit | Record | Init |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Drain node A from the pool | Active connections reach zero | Within 60 s | Drain duration | |

## Method

1. One action per step. A step containing "and" is two steps.
2. Every step producing an observation states the expected result and a concrete limit. "Verify it looks normal" is not a limit.
3. Every quantity the write-up will need has a Record cell. Data not recorded did not happen.
4. Derive abort criteria from the risk list, not a template: for each credible failure, what does the operator see, and what do they do?
5. Mark hold points and who must approve passing them.
6. State the safe state to return to after an abort at any step.
7. Number steps so a redline can reference one unambiguously.

## Review mode

Walk each step and ask: **how could this be misread?** Flag:

- ambiguous verbs — check, verify, ensure — with no observable outcome;
- missing limits, units, or tolerances;
- an expected result that cannot be observed with the listed tools;
- data the write-up will need that no step records;
- an ordering hazard: a step that changes state before its guard is in place;
- an abort criterion with no corresponding action;
- steps assuming knowledge not in the procedure.

Report findings as a table: step, issue, severity (blocking, should-fix, editorial), suggested wording.

## Redline mode

Produce a table: step, current text, proposed text, reason. Do not silently rewrite; a redline that cannot be diffed cannot be approved.

## Output

Use \`write\` for \`procedures/<name>-rev<n>.md\`. Put review findings in \`reviews/<procedure>-findings.csv\`. Summarize blocking findings in the chat.

Then call \`sidebar\` with the procedure path so the person can read it beside the conversation. Open the current revision only, not each intermediate one.

## Self-check

- Does every observation step have a concrete limit?
- Is every quantity the write-up needs recorded by some step?
- Does each risk have both an abort criterion and an action?
- Can a step be executed with only what section 3 lists?
- Is any step doing two things?

## Limits

- Do not invent identifiers, thresholds, credentials, or contact names. Mark \`TBD\` and list them.
- A procedure with real consequences needs review and approval by its responsible owner; say so in the output.
- If the risk list is unavailable the abort criteria are incomplete. State that rather than producing a plausible-looking list.`,
  },
  {
    id: "requirements",
    category: "engineering",
    name: "Write requirements",
    description:
      "Use when writing, decomposing, or critiquing requirements and shall statements, or defining how each will be verified. Do not use when building a traceability matrix, reviewing an interface document, or reviewing an analysis result.",
    instructions: `# Write requirements

A requirement is a contract with a test. If you cannot state the test, you have written an intention.

## The three questions

Ask these of every requirement, whether writing or critiquing:

1. **What need does it trace to?** A requirement whose parent is "we have always done it this way" is a candidate for deletion.
2. **How would we know it is met?** Name the method and the pass criterion before accepting the wording.
3. **Why that number, and why that tolerance?** A limit with no derivation will be argued about at the review and again at the failure board.

## Writing

Use a single \`shall\` per requirement, with the condition before the behavior:

- *Ubiquitous:* The \\<system\\> shall \\<behavior\\>.
- *Event-driven:* When \\<trigger\\>, the \\<system\\> shall \\<behavior\\>.
- *State-driven:* While \\<state\\>, the \\<system\\> shall \\<behavior\\>.
- *Conditional:* If \\<condition\\>, then the \\<system\\> shall \\<behavior\\>.
- *Optional:* Where \\<feature is present\\>, the \\<system\\> shall \\<behavior\\>.

Record for each: ID, text, rationale, parent ID, verification method, success criterion, and owner.

Verification methods: **Analysis** (calculation or model), **Inspection** (examination of the article or drawing), **Demonstration** (observed operation without instrumented measurement), **Test** (instrumented measurement against a limit). Choose the least costly method that actually closes the requirement, and state the criterion in the same units as the requirement.

## Critique

Flag each of these, with the rewritten statement:

- **Ambiguous:** adequate, sufficient, robust, minimal, user-friendly, as required, fast, typical.
- **Compound:** joins separable behaviors with "and" or "or". Split it.
- **Unverifiable:** no method or observable criterion exists.
- **Missing condition:** no operating state, environment, or duty cycle bound, so it implicitly applies everywhere.
- **Implementation in a requirement:** specifies a solution where it should specify a need.
- **Unit or tolerance gap:** a number with no unit, no tolerance, or a one-sided limit where both sides matter.
- **Unstated reference:** pressure without gauge or absolute, temperature without a reference state, load without a coordinate frame.
- **Conflict:** contradicts another requirement, directly or through a shared budget.
- **Untraceable:** no parent and no rationale.

## Decomposition

When decomposing a parent to children, show the budget: how the allowance divides, what margin is held at the parent level, and who holds it. An undocumented budget is where overruns come from. State the combination rule you used — sum, root-sum-square, or worst case — and why.

## Output

Use \`write\` for \`requirements/<set>.csv\` with columns: id, text, rationale, parent, method, criterion, owner, status. Put narrative rationale in \`requirements/<set>.md\`. Report critique findings as a table with the rewritten text beside each finding.

Then call \`sidebar\` with the requirement set path the person will actually review — the CSV when they are checking the set, the \`.md\` when they are checking the reasoning. Open one, not both.

## Self-check

- Does every requirement have exactly one \`shall\`?
- Does every requirement have a method and a criterion in matching units?
- Is every number's basis recorded, or explicitly marked TBD or TBR?
- Do the children's budgets sum to the parent's allowance, with the held margin named?

## Limits

- Do not invent a limit. Write TBD and record what determines it.
- TBD means not yet known; TBR means known but not yet agreed. Keep them distinct and list both.
- Standards and specification clauses recalled from memory are unverified. Cite them as needing confirmation against the controlled document.`,
  },
  {
    id: "traceability",
    category: "engineering",
    name: "Traceability matrix",
    description:
      "Use when building or auditing a requirements verification traceability matrix, or when asked about verification coverage, orphan requirements, or verification status. Do not use when writing requirement text, or reporting the results of one test.",
    instructions: `# Traceability matrix

Coverage has two directions, and a matrix that checks only one is why unverified requirements reach delivery.

## Before starting

Locate the requirement set and the verification records with \`glob\` and \`grep\`. Establish which columns identify a requirement, its parent, its verification method, the verification event, and its status. State the parsing you assumed.

## Method

1. **Downward: does every parent decompose?** Every non-leaf requirement should have children whose satisfaction implies the parent's. Report parents with no children, and parents whose children do not cover them.
2. **Upward: does every requirement justify itself?** Every requirement should have a parent or an explicit top-level source. Report orphans.
3. **Verification coverage: is every leaf closed?** Every leaf needs at least one verification event with a method, a criterion, and a result. Report:
   - requirements with no verification event (unverified);
   - requirements with an event but no result (open);
   - requirements whose result does not meet the criterion (failed);
   - verification events referencing no requirement (unbudgeted effort, or a missing requirement).
4. **Method consistency:** does the recorded method match the one the requirement specifies? A requirement calling for Test closed by Analysis is a finding unless a deviation is recorded.
5. **Compute status honestly.** Percent complete counts closed leaf requirements against all leaf requirements. Do not count a parent as closed because some children are.

Work in the sandbox for anything beyond a few dozen rows:

\`\`\`python
import csv
rows = list(csv.DictReader(open("requirements.csv")))
ids = {r["id"] for r in rows}
orphans = [r["id"] for r in rows if r["parent"] and r["parent"] not in ids]
leaves = ids - {r["parent"] for r in rows if r["parent"]}
\`\`\`

## Output

Use \`write\` for \`requirements/rvtm.csv\` with columns: requirement id, text, parent, method, criterion, verification event, result, status, evidence path. Write \`requirements/rvtm-summary.md\` with counts and exception lists.

In the chat: total, closed, open, unverified, failed, and orphaned counts, then each exception list by ID. For a small set, add a Mermaid decomposition graph.

Then call \`sidebar\` with \`requirements/rvtm.csv\` so the matrix opens beside the conversation. The matrix is the deliverable people work through row by row; the summary belongs in the chat.

## Self-check

- Did you check both directions of coverage?
- Are leaf requirements distinguished from parents in the percentage?
- Is every exception listed by ID rather than only counted?
- Does each closed requirement cite an evidence path?

## Limits

- Do not infer a parent-child link from similar wording or adjacent numbering. An unstated link is a finding, not something to fill in.
- Do not mark a requirement closed because a test of the same name exists; the recorded result must meet the recorded criterion.
- \`read\` handles UTF-8 text only. For a requirements tool export in a binary format, ask for CSV.`,
  },
  {
    id: "interface-review",
    category: "engineering",
    name: "Interface review",
    description:
      "Use when reviewing or drafting an interface control document or interface definition between subsystems, vehicles, payloads, or suppliers. Do not use when reviewing a general requirement set, an analysis result, or a full design review package.",
    instructions: `# Interface review

Interfaces fail where two organizations each assumed the other owned a parameter. Review for ownership and for worst-case stacking, not for completeness of the table.

## Coverage

Walk every discipline that crosses the interface. One that documents only the mechanical fit is incomplete:

- **Mechanical:** envelope, bolt pattern, datums, fastener spec, torque, preload, mass, center of gravity, moments of inertia, stiffness, alignment tolerance, and the coordinate frame each is expressed in.
- **Structural:** load cases, limit and ultimate loads, load paths, and factor of safety at the joint.
- **Thermal:** conductance across the joint, view factors, interface temperature limits in every mode, and survival versus operational ranges.
- **Electrical:** connector type and pinout, voltage and current with tolerances, inrush, grounding and bonding, shielding, and isolation.
- **Fluid:** fitting, working and proof pressures, flow rate, media and cleanliness, temperature range, and leak rate.
- **Data:** protocol, physical layer, rate, message definitions with units and ranges, timing and latency, and error handling.
- **Operational:** who does what, in what order, during integration, test, and separation or deployment.
- **Environmental:** the environments each side imposes on the other, including vibration, shock, acoustics, EMI, and contamination.

## Method

1. **Assign an owner to every parameter.** Which side defines the value, and which must accommodate it? An unowned parameter is the highest-severity finding you can make.
2. **Check units, frames, and reference states:** coordinate frame origin and orientation, gauge versus absolute pressure, mass versus force units, and the reference temperature for every dimension.
3. **Stack the worst case.** Take each tolerance to the unfavorable end and ask whether the interface still works: does it fit, does the connector mate, is the load path intact, is there still thermal margin? Report the stacked result, not the nominal.
4. **Check that both sides agree.** Where each side has its own document, compare value by value. A mismatch both parties signed is still a mismatch.
5. **Build the TBD and TBR register:** every open value with an owner, the date it is needed, and what it blocks.
6. **Check verification.** How will each parameter be confirmed before first mate — a fit check, a continuity test, a protocol test? An interface with no verification plan is an integration delay.

## Output

Use \`write\` for \`interfaces/<interface>-findings.csv\` with columns: id, discipline, parameter, finding, severity, owner, recommendation. Put the open register in \`interfaces/<interface>-open.csv\`.

In the chat: findings grouped by severity, the worst-case stack results, and open-item count by owner. Severity: **blocking** (hardware will not mate or will be damaged), **major** (rework or schedule impact), **minor** (clarity or traceability).

Then call \`sidebar\` with the findings path so they open beside the conversation. Open the findings, not the open-item register.

## Self-check

- Does every parameter have a named owner?
- Did you evaluate the worst-case stack, or only the nominal?
- Are coordinate frames and reference states stated for every dimensional and pressure value?
- Does every open item have an owner and a need date?

## Limits

- Do not resolve a TBD by choosing a plausible value. Record it as open with its owner.
- Do not assume a fastener, connector, or protocol standard's parameters from memory; cite the standard as needing confirmation.
- A drawing supplied as PDF or CAD cannot be read. Ask for the dimensions and tolerances in text.`,
  },
  {
    id: "test-report",
    category: "engineering",
    name: "Test report",
    description:
      "Use when writing or reviewing a post-test report for a hardware test such as hot-fire, vibration, thermal-vacuum, EMI, proof, leak, or functional. Do not use when reducing the raw data, writing the procedure to be run, or investigating an anomaly in depth.",
    instructions: `# Test report

A test report answers one question for a reader who was not there: did the article meet its requirements, and how do we know? Every pass or fail traces to a requirement and a measured number.

## Before starting

Gather with \`glob\` and \`read\`, and list what is missing: the procedure and its as-run redlines, the requirements being verified with their IDs, the reduced data, the as-built configuration, and the deviations and anomalies. Do not write a report that implies data you were not given.

## Structure

\`\`\`markdown
# <Article> <test type> test report

| | |
| --- | --- |
| Article and serial | |
| Test | |
| Procedure and revision | |
| Date and location | |
| Author | |

## 1. Objective
The requirements this test verifies, by ID.

## 2. Article configuration
As-built configuration, serial numbers, and every difference from the delivered configuration.

## 3. Setup and instrumentation
Facility, GSE, and fixtures. Channel table: channel, measurand, unit, range, accuracy, calibration date, location.

## 4. As-run summary
What actually happened, in sequence, with times. Every deviation from the procedure: step, what was done instead, who authorized it, and its effect on validity.

## 5. Results
One row per requirement: ID, requirement text, method, measured value, limit, margin, pass or fail.

## 6. Anomalies and observations
Each anomaly: what was observed, when, its effect on the result, and its disposition.

## 7. Conclusions
What the data supports, and only that.

## 8. Open items
Retests, unresolved anomalies, and unreduced data, each with an owner.

## 9. Data products
Files produced, with paths.
\`\`\`

## Method

1. Start from the requirements, not the data. List every requirement the test was meant to verify, then find the evidence for each. A requirement with no evidence is an open item, not a pass.
2. For each result give the measured value, the limit, and the margin using \`MS = allowable / actual - 1\`. A pass with no margin stated is not reportable.
3. Record every as-run deviation, including harmless-seeming ones, and state its effect on validity.
4. Keep observation separate from interpretation. Section 5 says what was measured; section 7 says what it means.
5. Conclusions may not exceed the data. If the test covered one axis, one temperature, or one duty cycle, say so rather than implying general qualification.
6. Route any anomaly needing a cause into a separate investigation and reference it; do not speculate about causes here.

## Output

Use \`write\` for \`reports/<article>-<test>-report.md\`. Put a long results table in \`reports/<article>-<test>-results.csv\`. Reference charts by path. Summarize the verdict and open items in the chat.

Then call \`sidebar\` with the report path so it opens beside the conversation. Open the report, not the results CSV or the charts it references.

## Self-check

- Does every pass or fail cite a requirement ID, a measured value, a limit, and a margin?
- Are all as-run deviations captured?
- Does any conclusion generalize beyond the conditions tested?
- Is every number traceable to a named data file or channel?

## Limits

- Do not invent a requirement ID, calibration date, operator name, or serial number. Leave \`TBD\` and list it as an open item.
- If the reduced data does not exist, produce it first; do not write results from a raw file by inspection.
- If the procedure is unavailable, the as-run section can only record what you were told. Say so.`,
  },
  {
    id: "nonconformance",
    category: "engineering",
    name: "Nonconformance report",
    description:
      "Use when documenting a part, assembly, or process that does not meet its specification and deciding its disposition: nonconformance report, material review, use-as-is rationale, or corrective action. Do not use when the cause of a failure is itself in question.",
    instructions: `# Nonconformance report

A disposition is an engineering judgement about margin, not a precedent search. "We accepted this last time" is not a rationale.

## Before starting

Establish the requirement or drawing callout violated, with its ID and exact text; the as-found condition with measured values; the affected serial numbers and effectivity; where the article is in its lifecycle; and who must approve.

## Structure

\`\`\`markdown
# NCR <id>

| | |
| --- | --- |
| Article and serial | |
| Effectivity | |
| Detected by / when / how | |
| Requirement violated | ID and exact text |

## 1. As-found condition
Measured values against specified values, with units and measurement uncertainty.

## 2. Immediate containment
Other units affected, quarantine, and stop-ship decision.

## 3. Engineering evaluation
Effect on form, fit, function, life, reliability, and safety. Margin before and after.

## 4. Disposition
Use as is, rework, repair, scrap, or return to supplier, with rationale.

## 5. Corrective action request
Cause of the escape, and the action preventing recurrence.

## 6. Approvals
\`\`\`

## Method

1. **Quantify the deviation:** specified value, actual value, difference, and measurement uncertainty. A deviation inside measurement uncertainty is a metrology question first.
2. **Evaluate the margin from first principles.** Recompute the affected margin with the as-found geometry, property, or process result. Report margin before and after. A use-as-is with no recomputed margin is not defensible.
3. **Check every consequence, not just the obvious one:** strength, stiffness, fatigue life, tolerance stack, thermal path, sealing, cleanliness, corrosion, and inspectability.
4. **Choose the disposition on the evidence:**
   - **Use as is** — margin remains positive with the as-found condition and no requirement is relaxed by implication. State the recomputed margin.
   - **Rework** — returns the article to full conformance. Reference the rework instruction.
   - **Repair** — returns it to a serviceable but non-conforming state. Needs its own analysis and usually customer concurrence.
   - **Scrap** — cannot be brought to a safe or serviceable state.
   - **Return to supplier** — supplier-caused and supplier-correctable.
5. **Distinguish the escape from the defect.** The corrective action addresses why the process produced it *and* why inspection did not catch it. Both, or the class recurs.
6. **Check effectivity.** Which other units, lots, or builds share the condition? Nonconformances are rarely unique.

## Output

Use \`write\` for \`quality/ncr-<id>.md\`. In the chat: the deviation, the recomputed margin, the recommended disposition in one sentence with its rationale, the effectivity, and the corrective action.

Then call \`sidebar\` with that path so the report opens beside the conversation. A disposition gets signed off, so the person needs to read the whole report.

## Self-check

- Does the report quote the violated requirement's exact text and ID?
- Is the margin recomputed with the as-found condition, not asserted?
- Did you consider consequences beyond the obvious one?
- Does the corrective action address both the defect and the escape?

## Limits

- Do not recommend use-as-is without a recomputed margin. If you lack the inputs, say what is needed.
- Disposition authority rests with the responsible engineer and material review board. Present the analysis and recommendation; state that approval is theirs.
- Do not assume a supplier's process capability or a material's as-delivered properties from memory.`,
  },
]
