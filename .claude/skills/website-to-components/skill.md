---
name: website-to-components
description: Clone a live website end-to-end, or build a single component from a section of a remote URL. When given a URL, screenshot the page, use AI vision to identify section boundaries, detect components, and build React + Storybook components. Everything runs from inside the ddev container after `ddev claude` — no pre-processing outside Claude. Activates when user says "screenshot", "clone", "analyze", "detect components", "build a component from", or "create a component from" for a URL.
---

# Website to Components Skill

## Purpose

Take a live website URL and produce React + Storybook components for Drupal Canvas. **Everything runs as a single continuous pipeline inside Claude Code — do not ask the user to run any scripts before entering the container.** The only command the user needs is `ddev claude` (or `claude` on host), after which this skill drives the entire pipeline to completion without stopping.

Two modes:
- **Full site clone** — multi-page by default, building all pages discovered from the main nav
- **Single component** — when the user points at a specific section on a URL ("build a component from the hero on https://example.com")

## Subagent spawning — worktree isolation must be disabled

When running inside a ddev container, Claude Code cannot resolve the git HEAD for subagent worktrees. **All subagents spawned by this pipeline must use `isolation: none`** (or equivalent — do not use `isolation: "worktree"`). If you see `Failed to resolve base branch "HEAD": git rev-parse failed`, it means a subagent was spawned with worktree isolation. Fix by explicitly passing `isolation: none` on every `Agent` tool call in this pipeline.

## Entry point — nothing runs outside Claude

**Do not instruct the user to run `ddev clone`, `run-multipage.js`, or any script before entering Claude.** All pipeline steps are initiated by the Claude Code agent from inside the session. The user's workflow is:

```bash
ddev claude   # enter the container and start Claude
```

Then tell Claude: `clone https://example.com` or `build a component from the navbar on https://example.com`

Claude handles everything from that point — screenshots, section detection, font extraction, component builds, Storybook validation — running continuously until done.

## How a domain URL is handled

When the user provides a single URL like `https://example.com`, treat it as a **multi-page clone request by default**:

1. **Screenshot** — full-page desktop screenshot via `agent-browser`
2. **AI section detection** (Step 2) — the agent reads the screenshot and identifies section boundaries using vision, understanding content structure (navbars, heroes, card grids, CTAs, footers) rather than colour deltas. Sections are cropped precisely without splitting text or cutting mid-component.
3. **Asset extraction** — fonts, images, CSS downloaded from the live page
4. **Component detection** (Step 3) — vision subagents identify the React components needed for each section
5. **Build** — parallel subagents write `index.jsx` + `component.yml` for every component
6. **Validate + compare** — Storybook renders each page story; pixel diff against source sections drives fixes

Shared components (Navbar, Footer, repeated cards) are built once and reused across pages.

If the user explicitly says "just the homepage" or "single page only", run on that page only.

## Single component from a URL section

When the user says something like:
- "build a component from the hero on https://example.com"
- "create a component from the card grid at https://example.com/about"
- "I want just the navbar from https://example.com"

Run a targeted single-section pipeline:

1. Screenshot the URL with `agent-browser`
2. Read the full-page screenshot and identify which section matches what the user described
3. Crop that section precisely
4. Run asset extraction for that section only
5. Build the component (Steps 5–5b)
6. Write a Storybook story for it
7. Validate with `canvas validate` + `canvas build`

Do not build the full site. Do not discover the sitemap. Do not wait for user confirmation between steps.

## Component naming — 3-letter site prefix (MANDATORY)

Every component built by this pipeline **must be prefixed with a 3-letter identifier derived from the site hostname**. This prevents collisions when multiple sites' components coexist in the same Canvas project.

**Deriving the prefix:**
- Take the primary domain name (strip `www.`, TLD, and hyphens)
- Use the first 3 letters, uppercased for PascalCase and lowercased for snake_case
- Examples:
  - `freelygive.io` → `frg` → `FrgNavbar` / `frg_navbar`
  - `example.com` → `exa` → `ExaHero` / `exa_hero`
  - `2comweb-telefoniabusiness.it` → `tco` (skip leading digit, use first 3 letters of meaningful word) → `TcoCard` / `tco_card`
  - `acquia.com` → `acq` → `AcqFooter` / `acq_footer`

**Rules:**
- `machineName` in `component.yml`: `<3-letter-prefix>_<component_name>` (snake_case, e.g. `frg_primary_button`)
- Component folder: matches `machineName` exactly (`canvas/src/components/frg_primary_button/`)
- React component name in JSX: PascalCase with prefix (`FrgPrimaryButton`)
- Import alias: `import FrgPrimaryButton from '@/components/frg_primary_button'`
- Story title: `'<Site Name>/<Component Display Name>'` (e.g. `'FreelyGive/Primary Button'`)

**Determine the prefix at the very start of the pipeline** (Step 0 / Step 3) and use it consistently for every component throughout the run. Never mix prefixes within a single site clone.

## Project Structure

```
/                                        ← project root (run all commands from here)
├── canvas/                              ← Storybook + React components
│   ├── src/components/<name>/           ← built components (index.jsx + component.yml)
│   ├── src/stories/components/          ← component stories
│   ├── src/stories/pages/               ← page assembly stories
│   ├── src/global.css                   ← design tokens + font-face declarations
│   └── public/fonts/ + images/          ← fonts and images served by Storybook
└── website-to-components/               ← pipeline tool
    ├── scripts/run.js                   ← Step 1+2 entry point
    ├── scripts/finish.js                ← Step 4 entry point
    ├── scripts/audit-content.js         ← Step 7 entry point
    ├── jobs/                            ← individual pipeline steps
    ├── lib/                             ← shared utilities
    └── output/<site>/                   ← generated output (gitignored)
```

**Always run commands from the project root**, not from inside `website-to-components/`.

## When This Skill Activates

- User provides a URL and says anything like "screenshot", "analyze", "clone this site", "detect components", "what components does X use"
- User runs `node website-to-components/scripts/run.js <url>` in the project and the output contains `CLAUDE_AGENT_HANDOFF`
- User says "run the pipeline on <url>"

## Pipeline Overview

```
Step 0 — Sitemap       node website-to-components/jobs/00-sitemap.js <url> → website-to-components/output/<host>/sitemap.json
                       (runs first; iterates remaining steps over every discovered page)

  PER PAGE (loop) ─────────────────────────────────────────────────────────────
  Step 1 — Screenshot    node scripts/run.js <page-url>           → output/<host>/<page-slug>/screenshot.png
  Step 2 — Split         [AI vision reads full-page screenshot]     → output/<host>/<page-slug>/sections/section-0N.png
  Step 2b — Assets       (runs inside run.js)                       → output/<host>/<page-slug>/site-resources.json
  Step 2c — Resources    (runs inside run.js)                       → output/<host>/<page-slug>/resources/
  Step 3 — Detect        [PARALLEL vision subagents]                → output/<host>/<page-slug>/components.json
  Step 3c — Fonts        [PARALLEL with Step 3] (ONLY ON FIRST PAGE)→ canvas/public/fonts/*.woff2
  Step 3d — Font gate    [MAIN AGENT, mandatory]                    → verify files + @font-face + @theme + computed styles
  Step 3d-css — global.css scaffold  node scripts/init-global-css.js
                          (MUST run once before Step 5 — bakes `@source inline(...)` so Tailwind works)
  Step 3d-tags — Image tagger        node jobs/03d-tag-images.js <url>
                          (writes image-tags.json — feeds Step 9 image picking) → output/<host>/image-tags.json
  Step 4 — Report        node scripts/finish.js <page-url>          → output/<host>/<page-slug>/report.md
  Step 4b — First-component smoke test (after the FIRST build subagent returns) — see Step 5a
  Step 5 — Build         [PARALLEL subagents, cap 5 each]           → canvas/src/components/<name>/   (REUSE before creating)
  Step 5b — Validate     npx canvas validate --all && npx canvas build   (MANDATORY after every component touch)
  Step 6 — Compare       Start Storybook → screenshot page story → per-section pixel diff → fix
  Step 6c — Section diff node website-to-components/jobs/07-section-diff.js <page-url> <story-url> (MANDATORY gate)
  ──────────────────────────────────────────────────────────────────────────────

Step 7 — Audit          node scripts/audit-content.js  (after all pages built)
Step 8 — Stories        [PARALLEL subagents]            → canvas/src/stories/components/  (one story per unique component)
Step 9 — Assemble       [PARALLEL subagents]            → canvas/src/stories/pages/       (one story per discovered page)
Step 10 — Link pages    Wire nav/footer linkTo() across all page stories
Step 11 — Timing report node scripts/timings-report.js <url> → output/<host>/timings-report.md
```

**Time every stage and every component.** Automated jobs already write to `output/<host>/timings.jsonl` via the timings module. The Claude agent must log every subagent it spawns and every component it builds, using the `log-timing.js` CLI. See "Recording timings" below.

Two entry points:

- **Multi-page (default)** — `node website-to-components/scripts/run-multipage.js <url>` runs Step 0 (sitemap) then Steps 1–2c automatically for every discovered page in one process. After it finishes, the Claude Code agent picks up at Step 3 for each page in turn.

  Pages are processed in parallel via `--concurrency N` (**default 6**, max 8). Each worker gets its own `AGENT_BROWSER_SESSION=wN` so the browser sessions don't collide. The screenshot phase is the largest single chunk of pipeline time, so this is the highest-leverage knob — measured behavior: c=2 cuts wall to ~60% of serial, c=3 to ~45%, c=4 to ~32%, c=6 to ~25%. Cap 8: above that agent-browser session startup throttles and per-worker latency rises. Use `--concurrency 1` for serial debugging. Per-worker records appear in `timings.jsonl` under `subagent: "w0" / "w1" / ...` so the timings-report shows which lane carried which pages.
- **Single page** — `node website-to-components/scripts/run.js <page-url>` runs Steps 1–2c for one specific URL. Use this when the user explicitly says "only the homepage", or to re-run a single page that already exists in the sitemap.

**Steps 3–10 must be done by the Claude Code agent** (no API key needed — uses the active session). Step 4 runs automatically inside `node scripts/finish.js`. Steps 3, 3c, 5, 8, 9 use parallel subagents.

**The pipeline does not stop at `components.json`. After writing it, the agent MUST continue through all remaining steps — finish.js, font extraction, component builds, visual comparison, content audit, and page story assembly — without waiting for the user to ask.**

**Use parallel subagents aggressively.** The dependency graph is:

```
run.js (Steps 1–2) ──────────────────────────────────────────────────────────────────────┐
                                                                                          ▼
[Subagent A] Vision: page 1 - detect sections + components  --+
[Subagent B] Vision: page 2 - detect sections + components  --+-- all done -> components.json per page --+
[Subagent C] Vision: page N - detect sections + components  --+                                         |
[Subagent D] Font extraction (Step 3c)  --------------------------------------------------------------------------+
                                                                                                              |
                                                                                                              v
                                                                         Step 3d font gate (MAIN AGENT — blocks here)
                                                                      │
                                                                      ▼
                                                              node finish.js (Step 4)
                                                                      │
             ┌────────────────────────────────────────────────────────┘
             ▼
[Atom Subagent 1]   Atoms A (≤5 pure components)         ─┐
[Atom Subagent 2]   Atoms B (≤5)                          │
[Atom Subagent 3]   Card atoms (≤5)                       │
[Atom Subagent N]   …cap atoms at 5                       │
[Composite Subagent 1]  Top + nav (≤3 composites)         ├─ → Step 6 (Storybook compare)
[Composite Subagent 2]  Card grids (≤3 composites)        │
[Composite Subagent 3]  Listing grids (≤3 composites)     │
[Composite Subagent 4]  Specialized organisms (≤3)        │
[Mixed Subagent N]      Content blocks/bands (≤4 mixed)   │
             └────────────────────────────────────────────┘
             Rule: max(subagent_duration) is wall-clock.
             Different caps per type — atoms 5, composites 3, mixed 4.
             Splitting a 5-composite subagent into two saves ~15m.
                                                                  │
                                                     Step 7 audit │
                                                                  ▼
[Subagent α] Component stories batch 1  ─┐
[Subagent β] Component stories batch 2  ├─ parallel (Step 8)
[Subagent γ] Component stories batch 3  ─┘
             ↓ all done
[Subagent I]  Page story — Homepage     ─┐
[Subagent II] Page story — Page 2       ├─ parallel (Step 9)
[Subagent …]  Page story — Page N       ─┘
```

**IMPORTANT — do not re-run the pipeline unless the user explicitly asks.** The existing section screenshots in `website-to-components/output/<site>/sections/` are the ground truth for all visual comparisons. Use them directly with the `Read` tool — never re-screenshot to check your work.

**IMPORTANT — never reopen the live site to inspect screenshots that already exist.** If `website-to-components/output/<site>/sections/` contains section images, read them directly with the `Read` tool. Only open the browser when you need live DOM data (computed styles, font-face rules, iframe src values) that cannot be obtained from the saved screenshots.

---

## Handling session-limit errors (universal — applies to every parallel subagent fan-out)

When a subagent returns a result whose text contains `session limit` or `usage limit`, treat it as a soft failure: the subagent did NOT do its work, and re-spawning immediately will hit the same limit again.

**Required behavior on any session-limit signal:**

1. **Stop the fan-out.** Do not spawn further subagents in the same wave.
2. **Surface the failure to the user** — tell them which subagents failed and that the session is rate-limited.
3. **Do not auto-retry without a backoff.** Either:
   - Pause via `ScheduleWakeup` for a delay greater than 1200s (≥20 min) and resume from the same step on wake; OR
   - Ask the user to confirm a manual retry once limits reset.
4. **Never re-spawn the exact same prompt** without the backoff — the limit is on tokens-per-time-window, not per-call, so back-to-back spawns are wasted work.

If only some subagents in the wave hit the limit, mark the others' work as the partial result and queue only the missing ones for the retry. Don't duplicate completed work.

---

## Page-story syntax pre-flight (universal — runs immediately after Step 9)

Storybook refuses to start when ANY story file contains JSX syntax that Vite's parser rejects. The most common landmines:
- `attr='foo\'s bar'` — escaped apostrophe inside single-quoted JSX attribute (parses as unterminated string).
- Adjacent JSX expressions `}{` with no whitespace.

Always run the validator after Step 9 writes page stories, before launching Storybook:

```bash
node website-to-components/scripts/validate-page-stories.js          # report-only
node website-to-components/scripts/validate-page-stories.js --fix    # auto-fix the escaped-apostrophe pattern
```

Exit 0 → safe to launch Storybook. Exit 1 → fix the reported files before continuing. The `--fix` flag rewrites `attr='foo\'s bar'` to `attr={\`foo's bar\`}` (template literal) — the only syntactically-equivalent form that JSX accepts.

---

## Recording timings (universal — applies to every stage)

Every cloned site gets a timing log at `output/<host>/timings.jsonl` that the agent and the automated jobs both write to. The goal is to see, after the run, which stages and which components were the slowest so the pipeline can be tuned.

### What's automatically timed (no agent action needed)

`scripts/run-multipage.js`, `scripts/finish.js`, and other Node jobs already wrap their `run()` calls with `lib/timings.js` `timed()`. These stages appear in the log automatically:

- `step-0-sitemap`
- `step-1-screenshot-desktop` / `step-1-screenshot-mobile`
- `step-2b-extract-assets`
- `step-2c-download-resources`
- `step-4-report`

### What the agent must log manually

Anything the Claude Code agent kicks off — a parallel subagent, a per-component build, a manual visual fix — has to be logged via the CLI. Pattern: record `start` when you spawn the work, then `end` (with `--duration`) when it returns.

For one-shot recording (the common case), record the completed event with `--duration`, `--tokens`, and `--tool-uses`. The subagent's completion notification includes a `<usage>total_tokens: N tool_uses: N duration_ms: N</usage>` block — pass all three through:

```bash
# Vision-analysis subagent that took 47s and used 18k tokens / 12 tool uses
node website-to-components/scripts/log-timing.js \
  --url <site-url> \
  --stage step-3-vision \
  --page <page-slug> \
  --subagent vision-1-3 \
  --duration 47000 \
  --tokens 18000 \
  --tool-uses 12 \
  --status ok

# A single component build (one of many in a subagent)
node website-to-components/scripts/log-timing.js \
  --url <site-url> \
  --stage step-5-build \
  --page <page-slug> \
  --component <PascalCaseComponent> \
  --subagent build-bottom \
  --duration 32100 \
  --status ok

# A canvas validate gate
node website-to-components/scripts/log-timing.js \
  --url <site-url> \
  --stage step-5b-validate \
  --page <page-slug> \
  --duration 14200 \
  --status ok

# A section-diff run (any sections over threshold → status fail)
node website-to-components/scripts/log-timing.js \
  --url <site-url> \
  --stage step-6c-section-diff \
  --page <page-slug> \
  --duration 9300 \
  --status fail \
  --meta '{"failed":["section-02","section-06"]}'
```

### Subagent timing — easiest workflow

When you spawn a parallel subagent with the `Agent` tool, the result notification includes a `<usage>total_tokens: N tool_uses: N duration_ms: N</usage>` block. After it completes:

1. Grab `total_tokens`, `tool_uses`, and `duration_ms` from the notification.
2. Run `log-timing.js` with `--stage`, `--subagent`, `--duration`, `--tokens`, and `--tool-uses`.
3. If you batched components inside the subagent (e.g. one subagent built 6 atoms), also log a per-component entry for each one using the same duration / count (rough estimate is fine — the subagent total is what's authoritative). For tokens you can split the subagent's total evenly across the components it built.

Always log tokens. The report's "Total LLM tokens" line is how we track real cost across runs — a slow stage that's cheap on tokens is less interesting to optimise than a fast stage that's burning 100k tokens per call.

### Stages the agent always logs

| When | Stage label | Required fields |
|---|---|---|
| After each Step 3 vision subagent returns | `step-3-vision` | `--subagent`, `--duration` |
| After the Step 3c font subagent returns | `step-3c-fonts` | `--duration` |
| After each Step 5 build subagent returns | `step-5-build` | `--subagent`, `--duration` |
| After building each component inside a subagent | `step-5-build` | `--component`, `--duration` |
| After every `npx canvas validate` / `canvas build` | `step-5b-validate` / `step-5b-build` | `--duration`, `--status` |
| After Step 6 Storybook start | `step-6-storybook` | `--duration` |
| After every `07-section-diff.js` run | `step-6c-section-diff` | `--duration`, `--status`, `--meta` |
| After Step 7 audit | `step-7-audit` | `--duration`, `--status` |
| After each Step 8 stories subagent returns | `step-8-stories` | `--subagent`, `--duration` |
| After each Step 9 page-story subagent returns | `step-9-page-story` | `--subagent`, `--page`, `--duration` |

### Generate the report at the end

After everything else is done, generate both the markdown summary and the HTML infographic:

```bash
node website-to-components/scripts/timings-report.js <site-url>
node website-to-components/scripts/timings-infographic.js <site-url>
```

Both reports must include the **process start and end times in GMT** at the top. The start time is the timestamp of the first entry in `timings.jsonl`; the end time is the timestamp of the last entry. Both are already recorded by the `timed()` wrapper — the report scripts should surface them as:

```
Process started:  2026-05-22T09:14:03Z (GMT)
Process finished: 2026-05-22T09:47:51Z (GMT)
Total wall clock: 33m 48s
```

If the report scripts do not yet emit these lines, add them manually to the generated `timings-report.md` and `timings-infographic.html` after running the scripts:

```bash
# Get first and last timestamp from timings.jsonl
node -e "
const lines = require('fs').readFileSync('website-to-components/output/<host>/timings.jsonl','utf8').trim().split('\n');
const first = JSON.parse(lines[0]);
const last  = JSON.parse(lines[lines.length-1]);
const start = new Date(first.startedAt ?? first.ts);
const end   = new Date(last.endedAt ?? last.ts);
const diffMs = end - start;
const mins = Math.floor(diffMs/60000);
const secs = Math.floor((diffMs%60000)/1000);
console.log('Process started: ', start.toISOString().replace('.000',''), '(GMT)');
console.log('Process finished:', end.toISOString().replace('.000',''), '(GMT)');
console.log('Total wall clock:', mins + 'm ' + secs + 's');
"
```

Outputs:
- `website-to-components/output/<host>/timings-report.md` — markdown summary
- `website-to-components/output/<host>/timings-infographic.html` — self-contained HTML page with 5 hero stats, Gantt-style timeline, per-stage and per-subagent duration + token bars, and the same suggestion engine as the markdown report. Open in any browser, no JS deps. It contains:

- Wall-clock total (sum of recorded durations — parallel work overlaps, so this is an upper bound)
- Per-stage rollup (count, total, mean, p95)
- Per-component build time (top 30) — surfaces components that are unusually slow
- Per-subagent rollup (top 20) — surfaces subagents that became the long pole
- Failure list — every entry recorded with `status: fail` and its error
- **Suggestions** — flags any stage > 20% of wall time, or any subagent that took >2× its peers in the same stage

Read the suggestions section and feed them back into the next site's run (e.g. "Step 5 build was 60% of total — split the shared-components subagent into 2 smaller ones next time").

---

## Execution Instructions

### Step 0 — Detect the main menu and build a sitemap (MANDATORY FIRST)

Before any per-page work, discover which pages exist by reading the site's main navigation. Run from the **project root**:

```bash
node website-to-components/scripts/run-multipage.js <url>
```

This wraps Step 0 + Steps 1–2c for every discovered page. It writes:

- `website-to-components/output/<host>/sitemap.json` — the list of pages with `slug`, `label`, `url`, `order`
- `website-to-components/output/<host>/<page-slug>/` — per-page screenshots + resources (`home` → `output/<host>/screenshot.png`)
- `CLAUDE_HANDOFF.md` — instructions naming every page so the agent can resume at Step 3

#### How main-menu detection works

`jobs/00-sitemap.js` uses **two layered signals**:

1. **`agent-browser snapshot`** — pulls the accessibility tree, finds every `navigation "<label>"` node, and picks the highest-scoring one. Scoring favors aria-labels containing "main"/"primary"/"site"; demotes "skip", "footer", "breadcrumb", "social", "utility".
2. **CSS heuristics (fallback)** — if no labeled nav wins, walks `header nav` → `nav[aria-label*=main]` → `[role=navigation]` → `nav` → `header`, ignoring anything inside `<footer>`, until it finds a region with ≥2 same-origin links.

Same-origin filter: skips `mailto:`, `tel:`, file downloads, fragment-only links, and obvious junk labels (`skip`, `cookie`, `search`, `language`, `login`, etc.).

#### Sites that don't behave the same way

Not every site has a clean semantic main nav. Handle these explicitly:

- **No `<nav>` element / no aria-label** — the CSS fallback usually still picks the header. Verify the discovered list looks right (the labels should look like real page names). If wrong, manually inspect the page with `agent-browser snapshot` and pick the right region, then re-run the eval against that region.
- **Single-page app with JS-injected nav** — the pipeline waits for `networkidle` before snapshotting. If the nav still isn't visible (e.g. hidden behind a hamburger at desktop width), open the page yourself and click the toggle before re-running detection.
- **Mega-menus with dropdown triggers** — when nav items are `<button>` triggers rather than `<a>` links, `00-sitemap.js` will only pick up the visible top-level `<a>` elements. To capture dropdown children, hover/click each trigger first (with `agent-browser click @ref`) and re-scrape, or hand-edit `sitemap.json` to add the missing URLs.
- **Authenticated nav** — if pages behind login matter, sign in first via `agent-browser` interaction commands, then re-run the sitemap step. Otherwise the public nav is all you get.
- **Pagination/listings instead of nav** — a blog homepage may not have a true main menu. For these, fall back to the single-page entry point (`scripts/run.js`) and treat each post URL the user explicitly names as a page.
- **Empty or 1-page result** — if Step 0 returns only `home`, decide between:
  - Continuing single-page (likely the right call for landing pages).
  - Asking the user for known page URLs to add manually to `sitemap.json` before iterating.

#### Verify the sitemap before iterating

After Step 0 produces `sitemap.json`, **read it and sanity-check** before iterating Steps 1–9 across every page:

- Are the labels actual page names, or noise like "Skip", "Search", "Language"? Drop the noise.
- Is the homepage included as `slug: "home"`? It must be — every multi-page run starts there.
- Are there duplicates with trailing slashes or query strings? Normalize/dedupe.
- Are sub-pages from dropdown menus included? If not and the user wants them, edit `sitemap.json` manually.

If the sitemap looks wrong, fix it before running the rest of the pipeline — iterating on a bad sitemap wastes time on the wrong pages.

### Step 1 + 2 — Per-page screenshot and AI section detection

For multi-page runs, `run-multipage.js` runs Step 0 + Steps 1–2c for every discovered page in one process. After it finishes, the Claude Code agent picks up at Step 3 for each page in turn.

For a single-page re-run or a hand-added page, run:

```bash
node website-to-components/scripts/run.js <page-url>
```

Wait for output containing `CLAUDE_AGENT_HANDOFF` before proceeding.

**Popup/modal handling:** If the URL triggers a popup form or modal (e.g. `?form=...` query params, newsletter overlays, cookie banners), the pipeline will automatically dismiss cookie banners. For other overlays that survive cookie dismissal — check the screenshot after run.js completes. If the popup occludes page content, the pipeline will have captured the page behind it (scrolling and animation locking happen before the screenshot). If the popup itself is a target component (e.g. a donation form modal), note it for Step 3 — it will appear as a section overlay and should be identified as a `form` type component.

**Re-running screenshots without losing section files:** Use `--no-clean` to skip wiping the output folder:

```bash
node website-to-components/scripts/run.js <url> --no-clean
```

Use this when you need existing `sections/` images still available after the run.

---

### Step 3 — Agent vision analysis: section detection + component identification (parallel subagents)

**Vision is the sole authority on section boundaries.** Do not use colour-delta heuristics or pre-cropped guesses to decide where sections start and end. The agent reads the full-page screenshot and uses semantic understanding — content structure, visual rhythm, background changes, whitespace bands, navbar vs hero vs band vs footer — to place boundaries precisely without splitting text or cutting mid-component.

**One subagent per page (default).** For multi-page sites, spawn one vision subagent for *each* page in parallel. Each subagent owns the complete vision pipeline for its page (read screenshot → detect section boundaries → identify components → write components.json) and returns when done.

Why: total vision wall is `max(subagent_duration)`, not sum. A 4-page-per-subagent batch takes ~12–15m wall (4 pages × 3–4m each, done serially inside one subagent). A 1-page-per-subagent fanout takes ~3–4m wall — the same per-page work runs in parallel.

```
CLAUDE_AGENT_HANDOFF: analyze N pages for <site> and write N components.json files

→ Spawn one subagent per page (N parallel, capped):
  Subagent: <page-slug-1>      (detect sections + write components.json)
  Subagent: <page-slug-2>      (detect sections + write components.json)
  Subagent: <page-slug-3>      (detect sections + write components.json)
  …
→ Wait for ALL to return
→ Verify every page has its components.json
```

The page slugs come straight from the site's sitemap (`output/<site>/sitemap.json`) — do not invent a slug shape. Some sites have flat slugs (`tickets`, `plan-your-visit`); some sites nest pages and the multi-page detector encodes nesting as `parent__child` (double-underscore). Use whatever the sitemap gave you.

**Concurrency cap:** the harness can typically run ~10 parallel subagents cleanly. For sites with >10 pages, batch in two waves (10 + 6) rather than a 16-wide spawn. If you hit session-limit on any subagent, **do NOT auto-respawn** — pause via `ScheduleWakeup` or surface to the user.

**Subagent prompt template (per page):**
> "Analyze ONE page (`<page-slug>`) of `<site>` and write its components.json. The full-page screenshot is at `website-to-components/output/<site>/<page-slug>/screenshot.png`. Read it with the `Read` tool and use AI vision to identify section boundaries semantically — look for content structure, background color changes, whitespace bands, navbar/hero/band/footer patterns — then crop each section precisely using `node website-to-components/scripts/crop-sections.js <page-url> /tmp/<slug>-sections.json`. **Never split text in the middle of a paragraph or cut a component in half.** For each identified section, identify the React component(s) needed. Write `components.json` using the Write tool. JSON shape per section: `{ section, sectionBounds, components: [{ name, type, description, layout, background, children }] }`."

**Fallback to batched fanout (only if needed):** if the harness can't run N parallel subagents OR you're working a non-multi-page run, fall back to 3–4 pages per subagent. Wall clock is dominated by the longest subagent — keep batches balanced.

For each section, identify the React components needed. Use this JSON shape:

```json
{
  "section": "<absolute path to section image>",
  "sectionBounds": { "y": 0, "height": 90 },
  "components": [
    {
      "name": "ComponentName",
      "type": "layout | section | card | typography | form | input | button | navigation | notification | image",
      "description": "...",
      "layout": "...",
      "background": "...",
      "children": ["ChildComponent"]
    }
  ]
}
```

Write the full array to `website-to-components/output/<site>/components.json` using the `Write` tool.

#### Screenshot observation rules — CRITICAL

**Before writing any description, carefully study the screenshot to map its structure:**

1. **Count the columns and rows.** Identify every visual band (row) and how many columns it contains. State this explicitly before describing content (e.g. "Section has 2 rows: top row = full-width hero; bottom row = 3-column card grid"). **This applies to cards, modals, and overlays too — they are not always single-column.**
2. **Identify what lives in each cell.** For every column/row intersection, note the element type (image, heading, body text, button, icon, badge) and its order top-to-bottom.
3. **Note alignment within each cell** — is text left-aligned, centered, right-aligned? Are items top/middle/bottom aligned?
4. **Measure relative widths.** Estimate each column's width as a percentage of its parent. Use visual reference points (e.g. a 3-col grid = ~33% each; a hero image taking ~55% of the row = 55/45 split).
5. **Only include text that is visible in the screenshot.** Never add placeholder, invented, or assumed text strings. If a UI element shows a label (e.g. a payment brand name, a "powered by" attribution), only include it if it is clearly legible in the screenshot. If it is too small to read, omit it entirely.
6. **Modals and overlays get the same column analysis as full sections.** A modal with an image on the left and a form on the right is a 2-column layout — implement it as `flex-row` with explicit column widths, not as a stacked single column. Never default to single-column without first confirming the screenshot shows no horizontal split.

#### Description guidelines

Descriptions must be detailed enough to rebuild the component without looking at the screenshot. Cover:

- Background color/gradient (exact hex)
- Typography: font family, size, weight, color, letter-spacing for every text element
- All visible text content verbatim — only text that appears in the screenshot, never invented
- Badge shapes, colors, positions (e.g. "amber pill, absolute top-right of photo")
- Icon styles, border radii, shadow depth, overlay effects
- State indicators (active tabs, selected dots, highlighted cards)
- Spacing and padding estimates

#### Layout description rules — CRITICAL

Every description MUST include a complete column/grid breakdown translatable directly to CSS. Format:

> "Outer container: flex row, 2 columns, 50/50 split, items-center, gap-8. Left column (50%): single `<img>` filling full column width. Right column (50%): flex row, 2 sub-columns — left sub-column 30% contains [element], right sub-column 70% contains [element], items-center, gap-4."

Rules:
- **Always state exact percentage splits** for every column pair. Never say "left column" without a width.
- **Describe nesting explicitly** — if a column contains sub-columns, state their widths too.
- **State whether images are `<img>` or CSS `background-image`** — this is critical for implementation. An `<img>` scales with its container; a CSS background needs explicit dimensions. When in doubt, verify via `agent-browser eval` before writing the description.
- **State alignment** — `items-start`, `items-center`, or `items-end` for every flex container.
- **Never say "left side has X, right side has Y"** without column widths and flex/grid type.

---

### Step 3b — Extract site resources (automated)

`node website-to-components/scripts/finish.js <url>` runs this automatically via `jobs/03b-extract-assets.js`.

It saves to `website-to-components/output/<site>/site-resources.json`:
- `<img>` elements — URLs and base64 images
- Inline `<svg>` elements — serialized as data URIs
- CSS `background-image` values — URLs and base64
- `<video>` / `<source>` elements
- Stylesheets, scripts, font links
- A `usage` annotation on each asset

Use this file as the reference for Step 5 — use real site URLs for all image/video props, never placeholders.

**IMPORTANT — `03b-extract-assets.js` only captures images present in the initial HTML.** It misses images injected by JavaScript after page load — including third-party widgets (Fundraise Up, Typeform, Intercom, chat widgets, etc.) that render their own `<img>` elements into the DOM. If a section screenshot shows an image that does not appear in `site-resources.json`, it was dynamically injected.

### Step 3b-extra — Deep DOM image scan for dynamic/widget content

**Run this whenever a URL contains a popup, modal, or embedded third-party widget** (e.g. a donation form, chat widget, video player). It opens the URL with the trigger param, waits for JS to settle, then scans the fully-rendered DOM including widget iframes:

```bash
node website-to-components/scripts/scan-dom-images.js "<url-with-trigger-param>"
# Example:
node website-to-components/scripts/scan-dom-images.js "https://example.com/?form=FUNJHNAUEXC"
```

This merges any newly found images into `site-resources.json` and downloads them to `resources/images/` and `canvas/public/images/<site>/`. Always run this before building any component that uses a modal or widget — never guess or substitute a different image.

---

### Step 3c — Download and wire up fonts (runs IN PARALLEL with Step 3)

**Spawn this as a background subagent at the same time you spawn the vision analysis subagents.** It is fully independent — it only needs the live page URL, not `components.json`.

Do this for every site. Never approximate with Google Fonts when the real fonts are available.

**1. Extract all `@font-face` declarations from the live page:**

```bash
agent-browser eval --stdin << 'EOF'
const fontFaces = [...document.styleSheets].flatMap(ss => {
  try { return [...ss.cssRules].filter(r => r instanceof CSSFontFaceRule).map(r => ({
    family: r.style.fontFamily,
    weight: r.style.fontWeight,
    style: r.style.fontStyle,
    src: r.style.src,
  })); } catch(e) { return []; }
});
JSON.stringify(fontFaces, null, 2);
EOF
```

**2. Capture computed typography per element type** — font family, size, weight, style, color, letter-spacing, line-height, text-transform for every key element type:

```bash
agent-browser eval --stdin << 'EOF'
const sel = (q) => document.querySelector(q);
const cs = (el) => el ? window.getComputedStyle(el) : null;
const pick = (el) => {
  const s = cs(el);
  if (!s) return null;
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    color: s.color,
    letterSpacing: s.letterSpacing,
    lineHeight: s.lineHeight,
    textTransform: s.textTransform,
  };
};
JSON.stringify({
  body:    pick(sel('body')),
  h1:      pick(sel('h1')),
  h2:      pick(sel('h2')),
  h3:      pick(sel('h3')),
  navLink: pick(sel('nav a')),
  button:  pick(sel('button, .btn, [class*="btn"]')),
  badge:   pick(sel('[class*="badge"], [class*="tag"], [class*="pill"]')),
  cardTitle: pick(sel('[class*="card"] h3, [class*="card"] h2')),
  label:   pick(sel('label, [class*="label"], [class*="eyebrow"]')),
}, null, 2);
EOF
```

Use the output to:
- Add missing `--color-*` tokens to `canvas/src/global.css` `@theme` for any text colors not already defined
- Add `letter-spacing` as Tailwind arbitrary values or theme tokens where values differ from Tailwind defaults (e.g. `tracking-[0.15em]`)
- Document per-element typography in `components.json` descriptions so components can reproduce exact styles

**YouTube videos — never use `<iframe>` embeds.** YouTube blocks iframe playback from localhost ("Video unavailable"). Instead:
1. Extract the real YouTube video IDs from the live page — **never guess IDs from screenshots or descriptions**, they will be wrong:
```bash
agent-browser open <url>
agent-browser eval --stdin << 'EOF'
JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({
  src: f.src,
  id: (f.src.match(/embed\/([^?&]+)/) || [])[1] || null,
})), null, 2);
EOF
```
2. Render a thumbnail + play button link instead:
```jsx
<a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer"
   className="relative block w-full aspect-video group">
  <img src={`https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`} className="w-full h-full object-cover" />
  <span className="absolute inset-0 flex items-center justify-center">
    <span className="w-12 h-12 bg-red-600 rounded-sm flex items-center justify-center">
      <svg className="w-5 h-5 text-white fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </span>
  </span>
</a>
```
Use `maxresdefault.jpg` (not `hqdefault.jpg`) — it loads from YouTube's image CDN without hotlink protection.

**Copy downloaded images to canvas/public** — after downloading resources, copy all images to `canvas/public/images/<site-slug>/` so Storybook can serve them locally. This is mandatory — CDN hotlink protection will block images from loading in local dev otherwise.

```bash
mkdir -p canvas/public/images/<site-slug>
cp website-to-components/output/<site-slug>/resources/images/* canvas/public/images/<site-slug>/
```

Then use `/images/<site-slug>/<filename>` paths in all component and story `src` props — never raw CDN URLs in hardcoded component arrays or story args. CDN URLs are only acceptable in `component.yml` examples (for Canvas CMS deployment).

**Run the resource downloader** — after `node website-to-components/scripts/finish.js` (which runs Step 3b), download all images, CSS, SVGs, and fonts into a local resources folder:

```bash
node website-to-components/jobs/03c-download-resources.js <url>
```

This creates:
```
website-to-components/output/<site>/resources/
  images/   — all <img> src URLs and CSS background-image URLs
  css/       — all linked stylesheets
  svg/       — inline SVGs saved as .svg files
  fonts/     — woff2/woff/ttf/otf files parsed from @font-face declarations
website-to-components/output/<site>/resources-manifest.json
```

**Copy fonts to canvas** — from the downloaded fonts folder, copy woff2 files to `canvas/public/fonts/`:

```bash
cp website-to-components/output/<site>/resources/fonts/*.woff2 canvas/public/fonts/
```

**Replace `canvas/src/global.css` font declarations** — remove any Google Fonts `@import` and add `@font-face` blocks using `/fonts/<filename>.woff2` paths. Vite/Storybook serves `canvas/public/` at `/`.

**Update `@theme` tokens in `canvas/src/global.css`:**
- `--font-sans` → body/UI font (e.g. `"<Body Font Name>", Georgia, serif`)
- `--font-heading` → display/heading font (e.g. `"<Display Font Name>", Georgia, serif`)
- `--font-script` → script/cursive font if present

**Add a global heading base rule** so `h1`/`h2`/`h3` automatically use the heading font:

```css
h1, h2, h3 {
  font-family: var(--font-heading);
}
```

---

### Step 3d — Font gate (main agent, not a subagent)

**Run this yourself before Step 4. Do not delegate. Do not skip.**

The font subagent in Step 3c runs in parallel and can fail silently — permission denied, browser not open, wrong path. Components built in Step 5 inherit whatever state `global.css` is in. If fonts are wrong at Step 5, they are wrong in every component. Fixing them after the fact requires touching every component. Verify now.

**1. Check font files are present:**

```bash
ls canvas/public/fonts/
```

If empty or missing the expected woff2 files: the subagent failed. Run the font download manually:

```bash
node website-to-components/jobs/03c-download-resources.js <url>
cp website-to-components/output/<site>/resources/fonts/*.woff2 canvas/public/fonts/
```

**2. Check `canvas/src/global.css` has `@font-face` blocks:**

```bash
grep "@font-face" canvas/src/global.css
```

If none: the subagent didn't write them. Add them manually — one block per font weight, using `/fonts/<filename>.woff2` paths.

**3. Check `@theme` tokens were updated:**

```bash
grep "font-sans\|font-heading\|font-script" canvas/src/global.css
```

`--font-sans` must name the body font. `--font-heading` must name the display font. If they still say defaults — update them now.

**4. Verify computed styles on the live page:**

```bash
agent-browser open <url>
agent-browser eval --stdin << 'EOF'
const pick = (el) => { const s = el && window.getComputedStyle(el); return s ? { fontFamily: s.fontFamily, fontWeight: s.fontWeight } : null; };
JSON.stringify({ body: pick(document.body), h1: pick(document.querySelector('h1')), h2: pick(document.querySelector('h2')), h3: pick(document.querySelector('h3')), nav: pick(document.querySelector('nav a')) }, null, 2);
EOF
```

Cross-reference the output against your `@font-face` names and `@theme` tokens:
- Body `fontFamily` → must match `--font-sans`
- h1/h2/h3 `fontFamily` → must match `--font-heading`
- `fontWeight` numbers must have a corresponding `@font-face` block

**Do not proceed to Step 4 until all four checks pass.**

---

### Step 3d-css — Scaffold canvas/src/global.css (MUST run once before Step 5)

`@tailwindcss/vite` under Storybook can silently fail to scan component JSX, leaving every utility class unstyled at runtime. The scaffolder bakes a `@source inline(...)` safelist into `global.css` that guarantees the standard pipeline output renders even if scanning misses files.

```bash
node website-to-components/scripts/init-global-css.js \
  --brand red=#DB0007 --brand cream=#FFFDE9 --brand lavender=#E3DEFF \
  --font-sans '<Body Font Name>' --font-heading '<Display Font Name>' \
  --force
```

Flags:
- `--brand name=#hex` (repeatable) — adds or overrides a brand color token. The default palette ships with neutral defaults so a missing `--brand` flag still produces a working file.
- `--font-sans <family>`, `--font-heading <family>` — set the body and heading font families.
- `--no-fonts` — skip `@font-face` blocks (e.g. when you use Google Fonts via `@import`).
- `--fonts-dir <path>` — override the woff2 scan directory (default `canvas/public/fonts`).
- `--force` — overwrite an existing `global.css`.

After running, the file will contain:
- `@import "tailwindcss";`
- `@source "./components"; @source "./stories";`
- `@source inline("flex grid bg-brand-red ...")` — universal utility safelist
- `@font-face` blocks for every `.woff2` discovered in `canvas/public/fonts/`
- `@theme { --color-brand-* ... }` from your flags
- `@layer base` mapping body → sans, headings → heading-font

**Re-run after any font change** or whenever you discover a new brand color. The `--force` flag is required to overwrite.

---

### Step 3d-tags — Tag downloaded images by subject (feeds Step 9)

```bash
node website-to-components/jobs/03d-tag-images.js <site-url>
```

Reads every image filename under `output/<host>/resources/images/` (and per-page resource dirs), tokenises the filename, and classifies it against a universal taxonomy (person, child, family, volunteer, event, building, location, food, vehicle, logo, hero, illustration). Writes `output/<host>/image-tags.json`.

Step 9 (page-story assembly) subagents read this file BEFORE picking an image for any section. This avoids the "event photo captioned as a portrait" failure mode and saves vision tokens — they no longer need to ls + read every filename.

For sites with a niche vocabulary, extend the taxonomy:
```bash
node website-to-components/jobs/03d-tag-images.js <url> --extra-tags '{"location":["alder-hey","gosh","cardiff"]}'
```

---

### Step 4 — Generate report

```bash
node website-to-components/scripts/finish.js <url>
```

Generates `website-to-components/output/<site>/report.md`. Skips asset re-extraction if `run.js` already produced `site-resources.json` and `resources-manifest.json`.

---

### Step 3e — Cross-check sections against components (mandatory before Step 5)

**Before building any components, verify every section has a corresponding component.**

Read all section images in parallel, then compare against the components list in `components.json`. For each section image that shows content not covered by an existing component name, add the missing component to `components.json`.

Common misses:
- A URL with query params (e.g. `?form=...`) may trigger a popup/modal visible in section screenshots — this needs its own component (e.g. `SiteDonationModal`) even if it overlays existing content
- A section may contain a sub-component (e.g. a form inside a hero) that was collapsed into the parent description — extract it as a separate component if it has distinct interactive or structural behaviour
- Section bounds sometimes clip mid-component — check adjacent sections for continuation of the same visual element

**Do not skip this check.** Building components without it means shipping incomplete component sets.

---

### Step 5 — Build components (parallel subagents)

**This step runs automatically after Step 4 — do not wait for the user to ask.**

**First-component smoke test (MANDATORY before fanning out):**

Spawn ONE subagent to build the smallest atom-batch (3–5 atoms). When it returns, run:

```bash
node website-to-components/scripts/start-storybook.js --port 6007 --timeout 60
node website-to-components/jobs/05-smoke-test-tailwind.js --port 6007 --probe-selector header
```

If the smoke test FAILS:
- The `bg-brand-*` utilities are not in the bundle → re-run `init-global-css.js --force` and confirm `@source inline(...)` is present.
- The probe selector renders without styling → the component build was fine but Tailwind didn't pick up its classes; expand the `@source inline()` safelist in `global.css`.

Do NOT spawn the remaining build subagents until the smoke test passes. The cost of one failed atom-batch is small; the cost of 6 parallel subagents writing 45 components against a broken Tailwind config is enormous.

**Parallelisation strategy — overlap Step 5 composites with Step 9 page stories:**

The 2026-05-23 measurement showed Step 5 (build) at 79.2m vs Step 9 (page stories) at 15.7m, run strictly serially: 79 + 16 = ~95m sequential cost. The two phases share no files (Step 5 writes `canvas/src/components/`, Step 9 writes `canvas/src/stories/pages/`) so they can run in parallel once their preconditions are met:

```
Phase A — Vision                                  Phase B — Atoms                Phase C — Composites + Page stories in parallel
                                                                                 ┌────────────────────────────────────────┐
[Vision Pg 1]   ─┐                       [Atom Subagent 1] ─┐                    │ [Composite Subagent 1] ─┐              │
[Vision Pg 2]   ─┼─→ all components.json [Atom Subagent 2] ─┤── all atoms exist  │ [Composite Subagent 2] ─┤── done       │
[Vision Pg …]   ─┤  (one subagent       [Atom Subagent N] ─┘                    │ [Composite Subagent N] ─┘              │
[Vision Pg N]   ─┘   per page, V4)                                                │                                        │
                                                                                 │ [Page Story Subagent 1] ─┐ done in     │
                                                                                 │ [Page Story Subagent 2] ─┤  parallel    │
                                                                                 │ [Page Story Subagent N] ─┘              │
                                                                                 └────────────────────────────────────────┘
                                                                                 │
                                                                                 ▼
                                                                          validate-page-stories.js
                                                                          start storybook → smoke test
```

Why this is safe:
1. **Atoms must exist before composites.** Composites import atoms. Composite subagents fail if the atom they import is missing.
2. **Atoms must exist before page stories.** A page story `import <SitePrefix>PrimaryButton from '@/components/<site_prefix>_primary_button';` will fail to compile if the atom is missing — but if the atom exists, the page story compiles even when composites are still being written (the page story files are JSX text; Vite only resolves imports when Storybook renders that story).
3. **Storybook smoke test waits.** Run the smoke test only AFTER both composite and page-story subagents have all returned. By then every reference resolves.

**Spawn multiple parallel subagents** — one per logical group. Do not build all components in a single sequential subagent.

#### Grouping strategy

First, scan `components.json` and deduplicate by component name. Then split into groups.

**Sizing rule (UNIVERSAL — applies to every Step-5 subagent):**

Build cost per component varies sharply by component *type*:

- **Atom** (pure, no `@/components/<name>` imports): ~60–90s/component. The component.yml shape is standard; the JSX is short.
- **Composite** (imports ≥1 sub-component): ~120–180s/component. Each import triggers its own validator round-trip; cross-component prop alignment is iterative.

Use *separate caps per type*, not a single uniform cap:

| Group type | Cap (components per subagent) | Expected wall time | Why |
|---|---:|---|---|
| **Atom group** (no sub-imports) | **5** | ~5m | Atoms validate quickly and don't have cross-component prop wiring. |
| **Composite group** (≥1 sub-import) | **3** | ~7m | Each composite needs its sub-components to exist (forces serialization within the group) and validates against a larger surface. |
| **Mixed group** (some imports, some not) | **4** | ~5–6m | Compromise. Prefer to split into pure-atom and pure-composite groups instead. |

**Empirical evidence (charity-site run, 2026-05-23):**
- A 5-component composite group (all five components importing card sub-components) took **28.6m wall** vs the median build subagent at **5.5m**. A 5× outlier.
- A 4-component atom group (all pure atoms) took 12.2m only because the subagent re-discovered the empty-`examples` rule across components. With the cheat sheet (Step 1), atoms drop to ~4m.

**The "longest subagent wins" rule.** Total wall clock is `max(subagent durations) + queue overhead`, not the sum. Splitting a 5-composite subagent into two 3-and-2 subagents almost halves Step 5's wall time at no extra CPU cost.

**Wall-clock projection (compute BEFORE spawning, type-aware):**

```
per_group_estimate_seconds = (atoms_in_group * 80) + (composites_in_group * 150) + 60
wall_clock_estimate_seconds = max(per_group_estimate_seconds for every group)
```

If `wall_clock_estimate_seconds > 480` (8 min), rebalance. The largest single group dominates the run.

**Algorithm:**

1. Deduplicate component names from `components.json`.
2. **Classify each component as atom or composite.** Scan the planned `index.jsx` (or the section description in `components.json` for clues). A component is a *composite* if it will import at least one other component built in this clone (Navbar imports Logo/Nav/PrimaryButton → composite; a standalone Primary Button → atom; Footer imports Logo/LinkList/Badge → composite; a SupportCard with no sub-imports → atom).
3. **Group purely by type first**, then by topic. Atom groups separate from composite groups; never mix unless unavoidable.
4. Allocate counts per type:
   - Atoms: `ceil(atom_count / 5)` subagents.
   - Composites: `ceil(composite_count / 3)` subagents.
5. **ASSERT before spawning**: every atom group ≤ 5; every composite group ≤ 3; mixed groups ≤ 4. AND `max(per_group_estimate_seconds) ≤ 480`. If either fails, rebalance.
6. **Schedule atoms first.** Spawn atom subagents in parallel. Composite subagents can start in parallel too BUT each composite will end up waiting for its sub-component if the import is broken — the validator will report "Component not registered". This is fine; just resolve in a second pass after atoms land.
7. Surface the breakdown in your text message before spawning: "Building 30 components across 8 subagents (atoms ×2 of 5, composites ×6 of 3): atoms-1 ~5m, atoms-2 ~5m, composites-1..6 ~7m each. Wall-clock estimate: 7m." Show predicted wall-clock per group.

| Subagent type | Typical contents | Class | Cap |
|---|---|---|---:|
| **Atoms A** | Logo, primary button, secondary button, text link, stat block | atom | 5 |
| **Atoms B** | Icon button, breadcrumb, badge, floating action button, section heading | atom | 5 |
| **Atoms C** | Page intro, page title, page hero, video embed, quote callout | atom | 5 |
| **Card atoms** | Support card, listing card, story card, news card, event card | atom | 5 |
| **Content blocks (mixed)** | Rich text, text+image split, impact stats, report-links block | mixed | 4 |
| **Bands (mixed)** | Yellow band, CTA band, partnership band, newsletter band | mixed | 4 |
| **Top sections** (composite) | Navbar (imports Logo+Nav+PrimaryButton), Footer (imports Logo+LinkList+Badge), Hero (imports PrimaryButton) | composite | 3 |
| **Card grids** (composite) | Themed card grids (each imports its card atom) | composite | 3 |
| **Listing grids** (composite) | Stories grid, News grid, Events grid, location list | composite | 3 |
| **Specialized organisms** (composite) | FAQ accordion (imports FAQ item), Events header (imports primary button), Volunteer form (imports primary button) | composite | 3 |

Wait for the design-tokens update to land in `canvas/src/global.css` before any section subagent starts (token changes are cheap and serial). After that, **launch atom subagents first, then composite subagents** — atoms must land before composite imports resolve.

**Subagent prompt template:**
> "Build these React components for `<site>`. Components: [list]. components.json: `website-to-components/output/<site>/components.json`. Section images: `website-to-components/output/<site>/sections/`. Target: `canvas/src/components/`. Read `canvas/src/global.css` first — add any missing design tokens before building. Follow the component-authoring skill. Each component needs `index.jsx` + `component.yml`. **For every component, FIRST run `node /var/www/html/website-to-components/scripts/init-component.js <machine_name> --display '<Display Name>' --prop ... --import ...` to scaffold a validated `component.yml` + `index.jsx`. Then edit only the JSX body to match the source section. This skips writing the YAML and the import block by hand — both of which produce ~30% of the per-component retries.** READ the "Canvas validator rules you WILL hit" cheat sheet below — it documents the errors `init-component.js` already avoids and the ones you may still hit when editing the JSX body."

#### Using `init-component.js` (highly recommended)

The scaffolder writes a `component.yml` + `index.jsx` skeleton that ALREADY passes `canvas validate`. The subagent then only needs to:
1. Edit the JSX body to match the source section.
2. Adjust default prop values to realistic site-specific examples.
3. Add Tailwind utility classes for the actual visual.

CLI form (full reference: `node website-to-components/scripts/init-component.js --help`):

```bash
# Atom (5-comp atom subagents)
node website-to-components/scripts/init-component.js <site_prefix>_donate_button \
  --display "<Site Prefix> Donate Button" \
  --prop label --prop href \
  --prop variant:enum:outline,solid

# Composite (3-comp composite subagents) — declare each sub-component to import
node website-to-components/scripts/init-component.js <site_prefix>_navbar \
  --display "<Site Prefix> Navbar" \
  --prop variant:enum:cream,lavender \
  --prop logoHref --prop nav1Label --prop nav1Href --prop nav2Label --prop nav2Href \
  --import <SitePrefix>Logo:<site_prefix>_logo \
  --import <SitePrefix>PrimaryNav:<site_prefix>_primary_nav \
  --import <SitePrefix>DonateButton:<site_prefix>_donate_button
```

Prop-type cheat sheet (case-insensitive, omit `<type>` to let the scaffolder infer from the name):

| `<type>` | Means | Notes |
|---|---|---|
| `string` | Plain string | Default for `label`/`heading`/`title`/`name`/etc. |
| `richtext` | HTML body | Adds `contentMediaType: text/html`. Inferred from `Body`/`Description`/`Excerpt`/`Answer`/`Content`/`Intro` suffix. |
| `url` | Anchor URL | Adds `format: uri-reference`. Inferred from `Href`/`Src`/`Url`/`Link` suffix or exact name `href`/`src`. |
| `image` | Image src (string) | Same shape as `url`. |
| `imageobj` | Canonical image $ref object | Use only when the consumer requires the canvas-module image schema. |
| `boolean` | true/false | Inferred from `is*`/`has*`/`show*` prefix. |
| `number` | Number | |
| `enum:a,b,c` | String enum | First value becomes default. Comma-separated; no spaces. |

The scaffolder auto-runs `canvas validate` on its output. If validation fails, the scaffolder bails — meaning the subagent never has to debug a malformed file the scaffolder produced.

#### Canvas validator rules you WILL hit (read BEFORE writing component.yml)

`npx canvas validate` enforces these rules — every build subagent has historically been bitten by them and re-run validation 3–5× per component, costing ~30s of wasted work each retry. Get them right on the first write and you cut build-phase wall clock by ~30%.

**Schema rules (component.yml itself):**

| Error | Cause | Fix |
|---|---|---|
| `Prop machine name "<x>" should be the camelCase version of its title` | Title `"Cta Label"` paired with machineName `ctaLabel` — but the validator builds the expected machineName from the title and compares. | Title and machineName must round-trip. Title `Cta Label` → machineName `ctaLabel`. Title `Image Src` → machineName `imageSrc`. Title `Body` → machineName `body`. |
| `drupal-canvas/component-prop-example-value-no-empty-string` | An `examples: ['']` line for an optional prop. | Either supply a real example value (e.g. `examples: ['#']`, `examples: ['Read more']`) OR omit the `examples:` line entirely. Empty strings are forbidden. |
| `'properties' is not a supported key on .items` (array prop) | `type: array` with `items.type: object` and inline `properties:`. | Don't use `type: array` for repeating items. Use the **parent/child slot pattern** OR flat numbered props (`card1Heading`, `card2Heading`, …). |
| `'properties' is not a supported key. '$ref' is a required key because props.<name>.type is object` | An object-typed prop with inline `properties: { src, alt }`. | Either use a string prop with `format: uri-reference` (preferred for the pipeline), OR reference the canonical image $ref: `type: object` + `$ref: 'json-schema-definitions://canvas.module/image'`. **Never both.** |
| `'canvas.js_component.<name>' config does not exist` (on upload) | An imported sub-component has `status: false`. | Anything imported by another component must have `status: true`. Default to `status: true` unless the component is purely internal. |

**Style rules (index.jsx / imports):**

| Error | Cause | Fix |
|---|---|---|
| `drupal-canvas/component-imports` rejects `@/lib/utils` or `@/lib/FormattedText` | Old skill examples used these paths. | `import { cn, FormattedText } from 'drupal-canvas';` |
| `drupal-canvas/component-imports` rejects `../<site_prefix>_foo/index.jsx` or `'./<SitePrefix>Foo'` | Relative paths to sibling components. | `import <SitePrefix>Foo from '@/components/<site_prefix>_foo';` — no extension, no relative path. |
| `Utilities were moved into the drupal-canvas package. The @/lib/utils path is provided by Canvas and cannot be used for local files.` | Same as above — repeated for clarity. | Same fix. |

**Property type cheat sheet (use these EXACT shapes):**

```yaml
# Heading / label / short string
title:
  title: Title
  type: string
  examples: ['A real example, never an empty string']

# Rich text (paragraphs / lists / inline links)
body:
  title: Body
  type: string
  contentMediaType: text/html
  examples: ['<p>Sample paragraph.</p>']

# URL / href
href:
  title: Href
  type: string
  format: uri-reference
  examples: ['/destination']  # or 'https://...'

# Image src as a string (preferred for clone pipeline)
imageSrc:
  title: Image Src
  type: string
  format: uri-reference
  examples: ['/images/<host>/your-image.webp']
imageAlt:
  title: Image Alt
  type: string
  examples: ['Alt text describing the image']

# Boolean toggle
showStar:
  title: Show Star
  type: boolean
  examples: [true]

# Enum (lowercase string values)
variant:
  title: Variant
  type: string
  enum: [outline, solid]
  examples: [outline]

# Object image (only when you NEED the canonical $ref form)
image:
  title: Image
  type: object
  $ref: 'json-schema-definitions://canvas.module/image'
  examples:
    - src: 'https://example.com/img.jpg'
      alt: 'Alt text'
```

**Mandatory file header (every component.yml):**
```yaml
name: <Site Prefix> Hero      # Title Case, with space, mirrors machineName
machineName: <site_prefix>_hero  # snake_case
status: true                  # ALWAYS true for components used by sections
required: []                  # Use a list of required prop machine names, or []
props:
  properties:
    # ... (see cheat sheet above)
```

**Mandatory index.jsx imports (every component file):**
```jsx
import React from 'react';
import { cn, FormattedText } from 'drupal-canvas';   // ONLY this path
import { cva } from 'class-variance-authority';      // Only if you have variants
import <SitePrefix>Subcomponent from '@/components/<site_prefix>_subcomponent';  // ONLY this path
```

**Defensive prop handling (always):**
```jsx
const heading = typeof headingObj === 'object' ? headingObj?.value : headingObj;
const safeHref = typeof href === 'string' ? href : href?.uri || '#';
```
Drupal Canvas sometimes hands components `{value, format}` for rich text and `{uri}` for hrefs. Reading the raw string OR object both works.

---

#### Per-component build checklist (each subagent must follow)

1. **Re-read the source section image** with the `Read` tool — do not rely on descriptions alone.
2. **Extract design tokens** — add missing colors/fonts to `canvas/src/global.css` `@theme` before writing the component.
3. **Map description → props** — each content area becomes a prop. **Canvas schema rules (these are hard requirements — Source rejects components that violate them):**
   - **Text/heading** → `type: string`
   - **Rich text** → `type: string`, `contentMediaType: text/html`
   - **Link/URL** → `type: string`, `format: uri-reference`
   - **Image** → `type: object`, `$ref: 'json-schema-definitions://canvas.module/image'`. **Never use inline `properties: { src: ..., alt: ... }`** — Canvas rejects with `'properties' is not a supported key. '$ref' is a required key because props.<name>.type is object`.
   - **Video** → `type: object`, `$ref: 'json-schema-definitions://canvas.module/video'`. Same `$ref` rule applies.
   - **Repeatable items** → use the **parent/child slot pattern**, NOT `type: array` of objects. Canvas rejects `array` props whose `items.type: object` declares inline `properties`. The error is identical: `'properties' is not a supported key on .items`. Build a parent component with a `slot` named `items` (or `cards`, `events`, etc.) plus a child component for each repeating item.
   - **Fixed-count repeats (e.g. always 3 cards, always 5 social links)** — acceptable alternative to slots: expose flat per-item props like `card1ImageSrc`, `card1Heading`, `card1Href`, `card2…`. Use this when the count is known and small. For variable counts use slots.
   - **Enum** → `type: string`, `enum: [a, b, c]`.
   - **Sub-components used by sections must have `status: true`**. Source uploads `status: true` components only; a `status: false` atom that a section imports will fail upload with `'canvas.js_component.<name>' config does not exist`. Default rule: anything imported by another component → `status: true`. Anything purely internal (sub-sub-component never imported elsewhere) → `status: false`. When in doubt, set `status: true`.
4. **Map children → slots** for composite components.
5. **Defensive prop handling** — always accept both the flat-prop and any legacy object/array shape. The React component reads the flat prop first, falls back to the legacy shape:
   ```jsx
   const src = imageSrc ?? image?.src ?? image?.uri ?? '<default>';
   ```
   This keeps existing page stories working when component.yml refactors flatten an object/array prop.
6. **camelCase machine names must match titles.** The `validate --deprecated` check enforces this. If the title is "Image Src", the prop machine name must be `imageSrc`. If you rename one, rename the other.
7. **Invoke the `component-authoring` skill** for `index.jsx`, `component.yml`, CVA variants.
8. **Validate before declaring done.** After writing each component:
   ```bash
   cd canvas && npx canvas validate --components <comp_name> --deprecated 2>&1 | head -20
   ```
   Fix every reported error, not just structural ones. The `Failed` rows in the validator's table are the same checks Source applies on upload — passing them locally guarantees the upload will succeed. **If you hit a validator error, look up the fix in the "Canvas validator rules you WILL hit" cheat sheet above — every common error has a documented fix there.**
6. **Component-reuse check** — before importing an existing component (e.g. `Logo`, `Button`, `Card`), open the source section and the section where the original was built side-by-side. If the visual appearance differs — size, layout, icon-only vs lockup, stacked vs horizontal, colour treatment — **do not reuse**. Build a variant (new component, or a size/variant prop on the existing one). The most common offender is the logo: navbar logos are usually horizontal lockups, while footer logos are usually larger standalone icons with a stacked wordmark beside them. Treat them as distinct components by default.

---

### Step 5b — Per-component validate + build gate (MANDATORY after every create/update)

**Run this immediately after creating or modifying ANY component or `component.yml`. Do not batch — run it per change.**

Canvas ships two CLIs that catch component-level mistakes before they reach Storybook or production:

```bash
# Lint — catches wrong imports, missing props, machine-name conventions, slot mistakes
cd canvas && npx canvas validate --all

# Build — runs the actual component bundler + Tailwind. Fails on syntax errors and bad refs.
cd canvas && npx canvas build
```

Run both after every component touch. Address every reported failure before moving on. Common failures:

- `Utilities were moved into the drupal-canvas package. The @/lib/utils path is provided by Canvas and cannot be used for local files.` → import `cn` and `FormattedText` directly from `'drupal-canvas'`, not from `@/lib/utils` or `@/lib/FormattedText`. The ESLint rule `drupal-canvas/component-imports` rejects the `@/lib/...` aliases on new components.
- `'drupal-canvas/component-imports': Use the @/components alias for sub-component imports.` → switch a relative import like `import <SitePrefix>Foo from '../<site_prefix>_foo/index.jsx'` to `import <SitePrefix>Foo from '@/components/<site_prefix>_foo'` (no `/index.jsx` suffix).
- `Prop machine name "X" should be the camelCase version of its title.` → either rename the prop machineName in `component.yml` to match the title, or rename the title. Canvas requires the two to align.
- `Component not registered / unknown component`. → folder name must equal the `machineName` in `component.yml` (snake_case). If you renamed a folder, the `@source` directives in `global.css` need to update too.
- Tailwind classes missing in build output. → `@source` in `canvas/src/global.css` must point at the component file. New components need a new `@source` line (or a glob that covers them).

To auto-fix simple issues:

```bash
cd canvas && npx canvas validate --all --fix
```

**Do not proceed to Step 6 until `canvas validate --all` and `canvas build` both succeed cleanly.** Catching these here is far cheaper than discovering them later when ten components are broken at once.

---

### Step 6 — Start Storybook, compare and fix

**This step runs automatically after Step 5 — do not wait for the user to ask.**

#### 6a — Start Storybook (always use the helper)

```bash
node website-to-components/scripts/start-storybook.js --port 6007 --timeout 60
```

The helper kills anything on the port, launches with `--ci` (no interactive prompts), polls until HTTP 200, prints PID + URL, and dumps the log tail if startup breaks. **Never call `npx storybook dev` directly** — the interactive prompt for port reuse and the `--ci` flag are the two most common causes of "Storybook silently failed to start" failures.

#### 6b — Open the page story and take a full screenshot

Storybook's iframe respects the agent-browser viewport (default 1280×720). At desktop width all `md:`/`lg:` Tailwind breakpoints activate. The "full" screenshot then spans 1280px × (page height) — which can be 20–30k pixels for a long page.

```bash
agent-browser open "http://localhost:6007/iframe.html?id=pages-<sitename>-homepage--default&viewMode=story"
# Wait for CSS injection and image load
sleep 5

# Above-the-fold viewport screenshot for fold compare
agent-browser screenshot /tmp/<site>-fold.png

# Full-page screenshot for assembly compare
agent-browser screenshot --full /tmp/<site>-full.png
```

Read both screenshots with the `Read` tool. Note that an extremely tall full-page screenshot (>15k px) scales to look narrow when rendered in markdown previews — that does NOT mean the layout is broken; verify width via `agent-browser eval "document.documentElement.offsetWidth"` (should be 1280).

#### 6b-pre — Check site-resources.json for video and verify fonts BEFORE comparing

**Do this before screenshotting Storybook.**

**Video check:**

```bash
node -e "const r = JSON.parse(require('fs').readFileSync('website-to-components/output/<site>/site-resources.json','utf8')); console.log(JSON.stringify(r.videos ?? r.filter?.(x=>x.tag==='VIDEO'), null, 2));"
```

If any `<video>` or `<source>` elements are present: find which section they appear in, check whether the component implements `<video>`, and add a `videoSrc` prop if missing.

**Font verification:**

```bash
agent-browser open <url>
agent-browser eval --stdin << 'EOF'
const pick = (el) => { const s = el && window.getComputedStyle(el); return s ? { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight } : null; };
JSON.stringify({
  body: pick(document.querySelector('body')),
  h1:   pick(document.querySelector('h1')),
  h2:   pick(document.querySelector('h2')),
  h3:   pick(document.querySelector('h3')),
  nav:  pick(document.querySelector('nav a')),
}, null, 2);
EOF
```

#### 6c — Per-section pixel diff (MANDATORY gate)

A single full-page eyeball-comparison hides per-section regressions. Use the section-diff job to score every section individually and fail loudly on outliers:

```bash
node website-to-components/jobs/07-section-diff.js \
  <page-url> \
  "http://localhost:6007/iframe.html?id=pages-<sitename>-<page-slug>--default&viewMode=story" \
  --threshold 0.15
```

What it does (universal — no project-specific logic):

1. Reads source sections from `output/<host>/<page-slug>/sections/section-NN.png`.
2. Screenshots the live Storybook page story.
3. For each source section, extracts the matching y-range from the live screenshot (scaled to the source dimensions) and runs pixelmatch against the source.
4. Writes `output/<host>/<page-slug>/diffs/section-NN-diff.png` showing exactly where pixels differ, and a `section-diff-report.md` summary.
5. Exits non-zero if any section exceeds the threshold.

**Tune the threshold to the situation:**
- `--threshold 0.05` — strict; expect this after polishing. Catches subtle font/colour mismatches.
- `--threshold 0.15` — pragmatic during early build; accounts for minor reflow when the Storybook viewport differs from the source screenshot width.
- `--threshold 0.30` — only useful when comparing across very different viewport widths. Anything above this is "are they even the same component?"

**Always open the diff PNG for every failing section** — it shows you which region drifted (pink = different). The most common signal categories:
- Diff concentrated at one element → that element is wrong (size, position, font, colour).
- Diff scattered across the whole section → font is wrong, or column widths are wrong, or padding is off.
- Diff at the section edges only → the y-bounds are misaligned (source and live sections start/end at different scroll positions). Re-check that the page story renders all components in the correct order.

#### 6d — Layout audit checklist (manual cross-check for the failing sections)

For **each section that failed** the pixel diff in 6c, walk through this checklist:

- [ ] **Column count and widths** — exact percentage splits match?
- [ ] **Sub-column nesting** — nested layouts rendered correctly?
- [ ] **Element tag** — `<h1>`/`<h2>` vs `<span>` (wrong tag misses global font rule)
- [ ] **Missing elements** — decorative images, SVG icons, route graphics present?
- [ ] **Card inner layout** — image, badge, title, description, sub-stats all present?
- [ ] **Wrapper/grid** — cards side-by-side have a grid wrapper?
- [ ] **Content accuracy** — stat values, badge text, headings match source exactly?
- [ ] **Video vs image** — video sections use `<video>` not `<img>`?
- [ ] **Font and color** — heading font matches `--font-heading`; brand colors correct?
- [ ] **Logo variants** — if this section uses a logo, is the source treating it as the same lockup as elsewhere, or as a distinct variant (e.g. icon-only, larger, stacked)?
- [ ] **Image asset choice** — when a section image is recognisable (a person, a building, a product photo), does the rendered component use the right file from `site-resources.json`? An image swap is the #1 source of high pixel diffs.
- [ ] **SVG curve/path direction** — for inline SVG dividers, masks, or curves, is the path direction (concave-up vs concave-down) correct? Reverse the control-point Y to flip a curve.

#### 6e — Fix all failing sections and re-run the diff

Fix every issue found, update `component.yml` for new props, update page story for wrong content. Then **re-run `07-section-diff.js`** until all sections pass the threshold. Don't move to Step 7 until the diff report is clean.

#### 6f — Per-file edit budget (HARD CAP — 3 edits)

To prevent endless iteration on a single component, every fidelity-iteration subagent must respect a **3-edit cap per file** (component `index.jsx`, `component.yml`, or page story `*.stories.jsx`). After 3 edits, that file is frozen for the remainder of the run — move on to the next file or stop.

Use the tracker before and after each edit:

```bash
# BEFORE editing — exits 1 if cap reached, agent must skip the file
node website-to-components/scripts/edit-budget.js check canvas/src/components/<site_prefix>_navbar/index.jsx

# AFTER a successful edit — increment the counter
node website-to-components/scripts/edit-budget.js bump canvas/src/components/<site_prefix>_navbar/index.jsx <agent-name>

# Anytime — see the full ledger
node website-to-components/scripts/edit-budget.js report

# Reset (e.g. between site runs)
node website-to-components/scripts/edit-budget.js reset
```

The ledger lives at `canvas/.edit-budget.json` and is shared across all subagents in the same run. **Spawn every fidelity subagent with the instruction: "Before each Edit/Write, run `edit-budget check <path>`. If it exits non-zero, skip that file. After every successful Edit/Write, run `edit-budget bump <path> <your-agent-name>`."**

This cap exists because pixel-diff iteration has rapidly diminishing returns past round 3 — most remaining diff is image-content variance, not a fixable structural issue, and further edits often regress other sections.

---

### `canvas download` is destructive — never run it casually

`npx canvas download` and `npx canvas pull` SILENTLY OVERWRITE every file under `canvas/src/components/` with whatever is on Source. If a Source-side `<site_prefix>_navbar` exists with an older schema, your local newer version is gone — and unless you've committed to git, there is no recovery.

**Rules:**

- **Before any download/pull,** confirm `git status` shows component files are tracked + committed, or copy `canvas/src/components/` to a temp dir.
- **Never run download to "see what's on Source."** Use the JSON:API root (`/<prefix>` or the `canvas push` plan output) to inspect. Canvas push prints a Create/Update/Delete table BEFORE acting — that's the safe way to compare.
- **Add `canvas/src/components/` to git** at the start of any clone project. Each component build subagent's output should be committable so a download wipe is recoverable.
- **The upload command (`canvas upload`) is additive** — it does not delete or rename. Use it for incremental fixes. `canvas push` is the destructive sync command — pushes new + deletes old. Reach for `upload` first.

### Step 7 — Run the content audit (MANDATORY GATES)

Five audits must pass before proceeding to stories assembly:

```bash
# 1. Component file existence + machine-name conventions
node website-to-components/scripts/audit-content.js

# 2. Universal image/alt entity audit — catches "golf photo captioned as a
# portrait of Dr X" mismatches and activity-keyword mismatches.
node website-to-components/scripts/audit-image-alts.js

# 3. Universal video presence audit — for every page whose
# site-resources.json records videos, verify the page story actually
# references each video's id / embedUrl / src.
node website-to-components/scripts/audit-videos.js

# 4. Universal section-description / component / story cross-check —
# for every section in components.json whose description mentions a video,
# verify the named component accepts a videoUrl prop AND the page story
# passes one to it. Catches the case where the description says "embedded
# video" but the component renders only an <img>.
node website-to-components/scripts/audit-section-descriptions.js

# 5. Universal hero audit — for every page's hero element, check video
# provenance, image asset provenance (imageSrc must trace back to a
# captured URL in site-resources.json), fabricated breadcrumb/subhead
# props, and full-bleed-vs-cream-intro component-class fit. Catches
# heroes that were filled in with plausible-sounding text/assets the
# source page never had.
node website-to-components/scripts/audit-heroes.js

# 6. Canvas validate over the whole component set
cd canvas && npx canvas validate --all
```

The image/alt audit flags two patterns:
- Alt names a specific entity (a named person, "portrait of …", "photograph of …") whose name tokens don't appear in the filename
- Alt mentions one activity (`marathon`, `golf`, `gala`, etc.) while the filename mentions a different one

Fix all failures by either (a) picking a file whose name matches the subject, (b) replacing the image with `https://placehold.co/<dims>?text=<description>` and tagging the alt with "(placeholder — no source asset available)", or (c) rewriting the alt to describe what is actually in the image.

---

### Step 8 — Write component stories (parallel subagents)

**Spawn parallel subagents** — batch components into groups of 5–8. All subagents run simultaneously.

Write a Storybook story for every built component under `canvas/src/stories/components/`.

**Rules:**
- File: `canvas/src/stories/components/<SitePrefix><ComponentName>.stories.jsx`
- `// @ts-nocheck` + `import React from 'react'` at the top
- Story title: `'<Site Display Name>/<ComponentDisplayName>'`
- `args` use real site content — re-read source section images from `website-to-components/output/<site>/sections/` before writing hero/banner props
- `parameters.layout`: `'fullscreen'` for navbar/footer/hero; `'centered'` for cards/atoms

---

### Step 9 — Assemble pages (parallel subagents) — can run IN PARALLEL with Step 5 composites

**Important — start as early as possible:** After Step 5's *atom* subagents have all returned (and atoms are present in `canvas/src/components/`), spawn Step 9 page-story subagents in parallel with Step 5's composite subagents. They share no files. The page-story subagents write JSX text whose imports will resolve once the composite subagents land; Storybook is only smoke-tested AFTER both finish. This overlap was measured to save ~10–15m of wall clock on a 16-page site.

If you're orchestrating manually, the readiness check is:
```bash
node website-to-components/scripts/page-readiness.js <page-url>
```
It prints which components a page references and which are already present in `canvas/src/components/`. A page is ready for its Step 9 subagent when every *atom* it needs exists. Composites can still be in flight.

**Spawn one subagent per page, all in parallel.**

**Rules:**
- File: `canvas/src/stories/pages/<SiteName><PageName>.stories.jsx`
- Story title: `'Pages/<Site Name> — <Page Name>'`
- Renders all section components in correct top-to-bottom order
- Props use real site content — re-read source section images before writing
- `layout: 'fullscreen'` and `backgrounds: { default: 'white' }`
- Navbar and Footer appear in every page story
- **Image picks must read `output/<host>/image-tags.json`** (produced by `jobs/03d-tag-images.js`). The subagent filters by required `subjects` (e.g. `person`, `family`, `event`) and falls back to placeholder URLs when no asset matches.
- **JSX attribute strings with apostrophes** must use a template literal: `attr={\`Phoebe's story\`}`. Never write `attr='Phoebe\'s story'` — JSX rejects `\'` and Storybook will refuse to start.

**After ALL page-story subagents return**, run the syntax validator before launching Storybook:
```bash
node website-to-components/scripts/validate-page-stories.js --fix
```
Auto-fixes the escaped-apostrophe pattern; bails on any remaining fatal issue.

#### Video-vs-image guardrails (UNIVERSAL — applies before any image is chosen)

A "section describes a video; component renders an `<img>`" bug is the single most common visual regression. There are three independent places to detect it, and the pipeline now checks all three.

**Where videos come from:** `jobs/03b-extract-assets.js` detects videos from every common pattern and writes them under `videos[]` in `output/<host>/<page-slug>/site-resources.json`:

- Native `<video>` / `<source>` elements (`kind: "native"`)
- `<iframe>` embeds for YouTube, Vimeo, Brightcove, Wistia, Loom, Dailymotion (`kind: "youtube" | "vimeo" | ...`)
- `data-*` attributes that store a video ID or URL (lightbox triggers, lazy-loaded players)
- JSON-LD `VideoObject` entries declared in `<script type="application/ld+json">`

Each record includes `kind`, `src`, `id`, `embedUrl`, `poster`, `title`, `containerSelector`, and `extractedFrom`.

**Important — videos are lazy-loaded.** YouTube and Vimeo iframes are inserted by the player API *after* the page settles and often only after the user scrolls them into view. The extractor handles this by opening the page → waiting for `networkidle` → scrolling down three times → scrolling up → waiting another 1.5s → then evaluating the DOM. If you see `0 video(s)` on a page you know has video, the lazy load didn't complete — extend the scroll or wait timing.

#### The video flow (universal — applies to any cloned site)

```
1. Step 2b — extractor populates  output/<host>/<page-slug>/site-resources.json videos[]
2. Step 3  — vision subagents read site-resources.json; for any section whose
             screenshot shows a video player (play button, dark thumbnail,
             "watch" labels, iframe outline), mention the word "video" or
             "embed" explicitly in the description AND list a video-capable
             component name (or build one) for that section.
3. Step 5  — every component that may render a video MUST expose a
             `videoUrl` prop (user-editable). The reference implementation
             is a `<SitePrefix>VideoEmbed` atom that parses any
             YouTube/Vimeo/native URL and renders a poster + play overlay
             link. Composite components like a text+image split accept a
             *single* `videoUrl` prop that, when set, swaps the right-hand
             <img> for that video-embed atom.
4. Step 9  — page stories must pass the real `videoUrl` (from
             site-resources.json embedUrl/src) into the component. Never
             substitute a still image for a video section.
5. Step 7  — three audits enforce the above:
               - audit-videos.js              (page story references each
                                               video's id/embedUrl/src)
               - audit-section-descriptions   (section descriptions that
                                               mention video → component
                                               accepts videoUrl AND story
                                               passes videoUrl)
               - audit-image-alts.js          (catches the wrong-image
                                               substitution if it slips by)
```

**Component-author rule (always):** any component that *may* render a video — hero, text+media split, testimonial card, founder bio block — exposes a user-editable `videoUrl` prop in its `component.yml` with a `string` / `uri` type and an example pointing at a real YouTube watch URL. The user must be able to change the video by editing that single prop. Composite components (Text+Video split, Hero with video, etc.) implement this by delegating to a child video-embed atom and forwarding `videoUrl` through. **Never hard-code a video URL inside the component.**

**Page-story author rule (always):** when a section description mentions a video, read `output/<host>/<page-slug>/site-resources.json` `videos[]`. Pick the entry whose `containerSelector` best matches the section position. Pass its `embedUrl` (or watch URL) as `videoUrl` on the rendered component. Set `videoTitle` from the video's `title` field where the component supports it.

**The missing-portrait canary case** — recorded permanently here so the failure mode stays salient: a 2-col text+video section describes a named person (founder, executive, profile bio). The shared asset pool has no portrait of that person. The page-story subagent grabs a thematically-unrelated photo (an event shot, a building, a group scene) and captions it "portrait of <name>". The fix has three layers:

1. Extractor surfaces the YouTube embed for that section (id captured under `videos[].id`).
2. The text+image-split component accepts a `videoUrl` prop and renders a video-embed child when it's set.
3. The page story passes the captured `videoUrl` from `site-resources.json`.

If any one of those three fails, the audits flag it. This pattern recurs on any site with founder bios, hero reels, testimonial videos, product demos, or campaign launches — the audits look for the video-keyword/video-prop/video-arg triad regardless of site or component naming.

#### Image-selection guardrails (UNIVERSAL — applies whenever a component or story picks an `<img>` src)

The shared asset pool at `canvas/public/images/<host>/` is the **union of every image scraped across the whole site**. It is *not* curated to match every subject a page mentions. When a subagent writes alt text faster than it verifies the image, you end up with mismatches like an event-action photo captioned as "portrait of <named person>". Apply these rules in order:

1. **Prefer the source page's own asset list.** Every cloned page has its own `output/<host>/<page-slug>/site-resources.json` listing only the images that page used. Read it first. Picking from a different page's pool is a red flag.

2. **Match the filename to the subject.** Filenames almost always carry topic hints (`Leisure-Classic-2025`, `Apr-Alder-Hey`, `103_SmilingMomAndChild`). Before assigning an image to a section, scan the filename:
   - If the section is about a **specific person**, the file should look like a portrait/headshot (`portrait`, `headshot`, `<name>`, `bio`, `staff`, `team`).
   - If the section is about an **event**, the file should reference that event (e.g. `marathon`, `gala`, `walk-2024`).
   - If the section is about a **building/place**, the file should look like a location (e.g. `<city>`, `<house-name>`, `exterior`, `interior`).
   - If the filename hints at a completely different topic (event name vs. person name, year mismatch, sport not mentioned in the section), **do not use it**.

3. **Visually verify before committing.** When in doubt — and the subagent often is — `Read` the image file with the Read tool to see it. Cost: one tool call. Saves: a mortifying mismatch shipping to production.

4. **Use a labelled placeholder when no real asset exists.** If the section references something the source did not photograph (a historical figure not depicted, a future event, a generic concept), do **not** substitute an unrelated image. Use `https://placehold.co/600x800?text=<description>` with an alt that explicitly notes it's a placeholder:
   ```jsx
   image={{
     src: 'https://placehold.co/600x800?text=Portrait+of+<Person+Name>',
     alt: 'Portrait of <Person Name> (placeholder — no source asset available)',
   }}
   ```
   The "(placeholder — no source asset available)" parenthetical is mandatory. It surfaces in audits and makes it trivial to find sections that need a curator's input.

5. **Never describe in alt text what isn't in the image.** Alt text reflects what is actually visible, not what the section is *about*. If the image shows an event in progress, the alt is "Person mid-action at a charity event" — never "Portrait of <named person from the section>". An alt/file mismatch is a stronger signal of a bug than the page-story diff.

6. **When the same subject is needed across multiple pages, build a tiny asset map** at the start of Step 9: `{ "<subject-slug>": "<src or placeholder>", "<another-subject-slug>": "...", ... }`. Every page story imports from that map. One source of truth per subject; a fix in one place propagates.

#### Subagent prompt addendum

Add this paragraph to every Step 9 subagent prompt verbatim:

> Before writing any `<img>` `src`, follow the image-selection guardrails: pick from the page's own `site-resources.json` first; match the filename to the subject (do not use an event photo for a person portrait); `Read` the file to verify when uncertain; if no real asset exists for the subject the section references, use `https://placehold.co/600x800?text=<description>` and add "(placeholder — no source asset available)" to the alt text. Never describe in alt what isn't in the image.

#### Audit hook

Add this to the post-build content audit so mismatches surface automatically: grep every page story for `<img>` src values whose filename stem (split on `-`, `_`, digits) shares no token with the alt text. Flag any hit.

#### Hero authoring guardrails (UNIVERSAL — applies to any `*Hero` / `*PageHero` element)

Heroes are the most-screenshot-compared element on every page and the regression that loudest readers notice first. The combination of vision-step misclassification, fabricated copy, and renamed assets makes them especially fragile. Treat them as a separate authoring contract:

1. **Hero asset must trace to `site-resources.json`.** Before passing `imageSrc`, `posterSrc`, or `videoSrc` to any hero, find a matching entry in the page's own `site-resources.json` — under `videos[]` (for video heroes), `backgroundImages[]` (Elementor-style sites store hero photos as CSS `background-image` on `e-con-full`/`e-flex` containers), or `images[]`. Use the *captured* filename (or download the captured URL into `canvas/public/images/<host>/` keeping its slug). Never rename to a "cleaner" name like `Tickets-1.webp`, `Park-Zones.webp`, `plan-your-visit-1.webp` — the rename severs the audit trail and the resolver tags it as fabricated.

2. **Video heroes are video-first.** If `site-resources.json.videos[]` has any entry whose `containerSelector` is at the top of the DOM (Swiper/Elementor hero band, lazy-loaded `<video>` directly under the navbar), the hero MUST pass `videoSrc` (or `videoUrl`) — even if the captured screenshot only shows the poster frame. The poster goes to `posterSrc`; the video src goes to `videoSrc`.

3. **No fabricated copy.** Only set `breadcrumb`, `subhead`, `eyebrow`, `secondaryCtaLabel` if the section's `components.json` description explicitly records that text. If the live hero has none of those, leave the prop empty (`""`). Plausible-sounding placeholder copy ("Home / Park Zones", "Choose your adventure across…") is the single most-flagged regression once the audit runs.

4. **No CTA unless the source has one.** Audit will not always catch a fabricated `ctaLabel`, so the build subagent has to self-police: every hero CTA prop has to map to a visible button in the section crop. If the hero CTA already exists in the navbar, don't duplicate it into the hero overlay.

5. **Cream/intro hero ≠ full-bleed photographic hero.** If section 1's components.json description signals "cream background", "off-white background", "no photo", "centered text block", or section height < 200 px, the story MUST use a lightweight intro variant (a `*PageIntro` / `*PageHeader` atom, or equivalent) — not a full-bleed `*PageHero`. The audit will flag this when the description contains any of those phrases.

6. **Merge hero continuations.** Sometimes the vision agent splits a tall hero into two adjacent sections when the visual break is ambiguous. If `components.json` shows contiguous sections where one is labelled as a hero and the next as a continuation of the same hero, merge them into a single section with combined bounds before generating the page story. Re-crop using `crop-sections.js` with the merged bounds and re-describe the merged section.

#### Subagent prompt addendum (hero)

Add to every Step 5 / Step 9 subagent prompt verbatim:

> When the section is a hero or page hero, **never fabricate** `breadcrumb`, `subhead`, `eyebrow`, or `ctaLabel` — only set them if the section description explicitly records that copy. Look up `imageSrc`/`videoSrc` in the page's own `site-resources.json` and use the captured filename — do not rename. If `site-resources.json.videos[]` has a hero-region entry, the hero MUST pass `videoSrc`. If the section is a cream-background text block (no photo), use a lightweight intro component, not a full-bleed `*PageHero`.

#### Audit hook (hero)

`scripts/audit-heroes.js` checks four classes of hero regression per page: video-source provenance, image-asset provenance (must trace to `site-resources.json`), fabricated `breadcrumb`/`subhead`, and component-class fit (cream-bg intro mis-rendered as a photographic hero). Run after every Step 9 build; fail the page-story step on any non-zero exit.

---

## Skills

All skills in this project are real local copies (not symlinks) stored in `.claude/skills/`. When updating a skill, edit the copy in `.claude/skills/` directly — changes take effect immediately in the current session.

Skills used by this pipeline:
- `.claude/skills/website-to-components/` — this skill (pipeline orchestration)
- `.claude/skills/component-authoring/` — how to write `index.jsx` + `component.yml`
- `.claude/skills/stories/` — how to write Storybook stories
- `.claude/skills/create-component/` — component scaffolding
- `.claude/skills/typography-audit/` — typography verification

---

## Tools Used

- `Bash` — runs pipeline scripts
- `Read` — reads section images for vision analysis and visual comparison
- `Write` — writes `website-to-components/output/<site>/components.json`

## Output Files

The homepage uses `<page-slug>` = `home` and is placed directly under `output/<host>/`. Other pages live in `output/<host>/<page-slug>/`.

| File | Description |
|------|-------------|
| `website-to-components/output/<host>/sitemap.json` | List of pages discovered from the main nav (host-level) |
| `website-to-components/output/<host>/meta.json` | Host-level metadata (includes legacy sitemap mirror) |
| `website-to-components/output/<host>/screenshot.png` | Homepage full-page screenshot |
| `website-to-components/output/<host>/<page-slug>/screenshot.png` | Per-page screenshot for non-homepage URLs |
| `website-to-components/output/<host>/<page-slug>/sections/section-0N.png` | Sliced section images — ground truth for all visual comparisons |
| `website-to-components/output/<host>/<page-slug>/components.json` | Detected components per section, per page |
| `website-to-components/output/<host>/<page-slug>/site-resources.json` | Per-page asset inventory with usage annotations |
| `website-to-components/output/<host>/<page-slug>/resources/images/` | Downloaded image files for this page |
| `website-to-components/output/<host>/<page-slug>/resources/fonts/` | Downloaded font files (extracted once on the first page) |
| `website-to-components/output/<host>/<page-slug>/report.md` | Human-readable component breakdown for the page |
| `canvas/src/global.css` | Design tokens + @font-face declarations (shared across all pages) |
| `canvas/public/fonts/*.woff2` | Site fonts served by Storybook |
| `canvas/public/images/<host>/` | Site images served by Storybook (merged across pages) |
| `canvas/src/components/<name>/` | Built components (index.jsx + component.yml) — shared across pages |
| `canvas/src/stories/components/` | One Storybook story per unique component |
| `canvas/src/stories/pages/` | One Storybook page-assembly story per discovered page |

## Example Usage

```
User: clone https://example.com
```

The agent executes the **multi-page pipeline** end-to-end without pausing for user input:

1. Run `node website-to-components/scripts/run-multipage.js https://example.com` → detects main nav → builds `output/example.com/sitemap.json` → loops screenshot + assets + download for **every page** in the sitemap
2. **Sanity-check the sitemap** — read `sitemap.json`, drop any obvious noise rows, confirm the homepage is present
3. **For each page** (homepage first):
   - **[Parallel]** Spawn 1 vision subagent per page — reads the full-page screenshot, detects section boundaries using AI vision (content structure, background changes, whitespace, component roles), crops sections precisely, identifies components, writes `components.json`
   - **[Parallel — first page only]** Spawn 1 font subagent to download fonts + update `canvas/src/global.css`
   - Run `node scripts/finish.js <page-url>` → per-page report
   - **[Subagent 1]** Build shared components (tokens, Navbar, Footer, atoms) — only on the first page; **reuse existing components on later pages, but apply the component-reuse check from Step 5 (especially for logos)**
   - **[Subagents 2–N in parallel]** Build the page-unique section components
   - **After every component create/update**: run `cd canvas && npx canvas validate --all && npx canvas build`. Fix any failure before moving on.
   - Start/keep Storybook running → open that page's story → screenshot → run `jobs/07-section-diff.js` → inspect every failing section's diff PNG → fix → repeat until all sections pass the threshold
4. After all pages built: run `node website-to-components/scripts/audit-content.js` → fix failures
5. **[Parallel subagents]** Write component stories in batches of 5–8 (every unique component)
6. **[Parallel subagents]** One subagent per page story — assembles all sections in top-to-bottom order
7. Wire `linkTo()` between Navbar/Footer links and page stories so users can navigate between cloned pages inside Storybook

**The pipeline is complete only when ALL of the following are true — check each explicitly before declaring done:**

- [ ] Every component in `components.json` has been built (`canvas/src/components/<prefix>_<name>/index.jsx` + `component.yml` exist)
- [ ] `cd canvas && npx canvas validate --all` passes with no errors
- [ ] `cd canvas && npx canvas build` passes
- [ ] **Every unique component has a Storybook story** under `canvas/src/stories/components/` (Step 8 — one `.stories.jsx` per component)
- [ ] **Every page in `sitemap.json` has a Storybook page story** under `canvas/src/stories/pages/` (Step 9 — one `.stories.jsx` per page)
- [ ] Visual comparison passes for every page (`07-section-diff.js` exits 0)
- [ ] `audit-content.js` passes
- [ ] Clicking any nav link in any page story navigates to another built page story (Step 10)

**Do not stop after building components.** Steps 8 (component stories) and 9 (page stories) are mandatory and must run even if the user has not explicitly asked for them.

### Single-page override

If the user explicitly says "just the homepage", "single page only", or names one URL with no mention of "all pages" / "menu" / "site", skip Step 0 and run the single-page entry point instead:

```bash
node website-to-components/scripts/run.js <url>
```

Then continue with Steps 3–9 on that one page only.

---

## High-Fidelity Visual Analysis Framework

To reproduce a website with high fidelity, extract far more than "layout + colors." The best results come from modeling the page as a layered design system plus a rendered visual scene. Apply this framework during Step 3 (vision analysis) and Step 6 (comparison/repair).

### 1. Global Page Metadata

**Viewport & Rendering Context**
- Screenshot dimensions, pixel ratio/DPR, responsive breakpoint
- Sticky element state, scroll position, safe areas
- Light/dark mode, OS rendering differences

**Document Structure**
- Page width, max container width, content gutters
- Grid system, baseline rhythm, vertical spacing scale
- Z-index layering map, fixed/sticky regions

### 2. Layout System Detection

**Layout Model** — Determine whether sections use: CSS Grid, Flexbox, absolute positioning, or hybrid systems.

**Grid Analysis** — Extract: number of columns, column widths, row heights, gap spacing, alignment rules, breakpoints, responsive collapse rules.

**Spacing System** — Identify the spacing scale: padding, margin, section spacing, card spacing, whitespace rhythm, symmetry/asymmetry.

**Alignment** — Detect: left/right/center, optical alignment, baseline alignment, edge consistency, vertical centering.

### 3. Typography System

Most clones fail here.

**Font Identification** — Detect: font family, fallback stack, font source, variable font axes, font smoothing behavior. Use OCR + font matching.

**Text Metrics** — Capture: font size, line-height, letter spacing, word spacing, font weight, font style, text transform, paragraph width, character density.

**Text Semantics** — Identify: heading hierarchy, body styles, labels, buttons, captions, navigation, metadata, links.

**Advanced Typography** — Detect: ligatures, kerning, optical sizing, hyphenation, text truncation, gradient text, text shadows.

### 4. Color System

**Global Palette** — Extract: primary, secondary, accent, neutral scale, semantic states, background layers.

**Precise Color Data** — Capture: HEX, RGB, HSL, opacity, alpha blending, gradients, overlay colors.

**Contextual Roles** — Identify: surface colors, border colors, hover/disabled/active/focus states.

**Gradient Analysis** — Detect: linear/radial/conic, direction, stop positions, blending mode.

### 5. Shape Language

**Corner System** — Measure: border radius scale, elliptical radii, inconsistent radii, radius inheritance.

**Borders** — Capture: thickness, style, opacity, double borders, inner borders.

**Shadows** — Extract: X/Y offset, blur radius, spread, color, layer count, inner vs outer.

**Visual Geometry** — Identify: sharp vs soft design language, organic vs rigid geometry, angled sections, clipping/masks, SVG masks (webkit-mask-image), skew transforms, curves/waves.

### 6. Image & Media Analysis

**Image Properties** — Capture: exact rendered dimensions, aspect ratio, cropping method, object-fit style, retina scaling.

**Image Treatment** — Detect: overlays, blur, tinting, duotone, masks, rounded corners, shadows, blend modes.

**SVG Masks** — Extract the actual SVG path when `-webkit-mask-image` is used. Inline the SVG as a data URI in the component. Never approximate with `border-radius: 50%` when a custom mask shape exists.

**Logo transparency** — Logos with transparent backgrounds must be uploaded as PNG, not JPG. Detect via alpha channel presence in the source image.

### 7. Component Detection

**Core Components** — Identify: buttons, cards, inputs, navbars, heroes, footers, carousels, accordions.

**Component Variants** — Detect: primary/secondary, hover/active/disabled/loading states, size variants.

**Component Relationships** — Understand: parent-child hierarchy, nesting rules, repetition patterns.

### 8. Interaction & State Inference

**Interaction Indicators** — Infer: hover styles, clickability, focus targets, cursor expectations, animation hints.

**Dynamic UI Clues** — Detect: carousels, sliders, expandable sections, sticky behavior, scroll-triggered animations.

### 9. Visual Effects

**Effects** — Capture: blur, backdrop blur, glassmorphism, noise textures, transparency, blend modes, masks.

### 10. Responsive Behavior

**Breakpoint Prediction** — Estimate: mobile breakpoints, tablet behavior, desktop scaling.

**Reflow Rules** — Detect: stack direction changes, hidden elements, font scaling, column collapse behavior.

### 11. Design System Extraction

**Tokenization** — Extract reusable tokens: spacing scale, color tokens, radius scale, typography scale, shadow scale.

**Pattern Recognition** — Identify: repeating card systems, repeating section layouts, reusable compositions.

### 12. Multi-Pass Reconstruction Pipeline

Single-pass generation usually fails. Use this order:

1. **Pass 1 — Structural Layout**: Major sections, containers, grid
2. **Pass 2 — Component Recognition**: Cards, buttons, navigation
3. **Pass 3 — Typography**: Font mapping, spacing, hierarchy
4. **Pass 4 — Styling**: Colors, shadows, radii
5. **Pass 5 — Effects**: Blur, gradients, SVG masks, noise
6. **Pass 6 — Validation**: Compare generated render vs original

### 13. Quality Validation with pixelmatch

Use [pixelmatch](https://github.com/mapbox/pixelmatch) for pixel-level diff comparison between the clone and source screenshots.

```bash
# Install
npm install pixelmatch pngjs

# Compare two screenshots
node -e "
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const fs = require('fs');

const img1 = PNG.sync.read(fs.readFileSync('source-section.png'));
const img2 = PNG.sync.read(fs.readFileSync('clone-section.png'));
const { width, height } = img1;
const diff = new PNG({ width, height });

const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
fs.writeFileSync('diff.png', PNG.sync.write(diff));
console.log('Different pixels:', numDiffPixels, 'of', width * height, '=', (numDiffPixels / (width * height) * 100).toFixed(1) + '%');
"
```

**Thresholds:**
- < 2% pixel diff: acceptable clone fidelity
- 2–10%: noticeable differences, review diff.png for specific issues
- > 10%: significant layout or styling mismatch — investigate

Use the diff image to pinpoint exactly which regions differ. Common failure areas revealed by pixel diff:
- Incorrect line-height (affects all text blocks)
- Wrong font weights
- Missing shadows
- Wrong container widths or padding
- Incorrect image crop/aspect ratio
- Color value off by shade

### 14. Common Failure Areas

Most AI cloning systems fail here — check these first in any visual comparison:

- Incorrect line-height
- Wrong font weights
- Missing optical spacing
- Improper shadows
- Wrong container widths
- Incorrect responsive behavior
- Misidentified flex/grid rules
- Ignoring baseline rhythm
- Wrong image crop
- Incorrect vertical spacing accumulation
- Approximating SVG masks with border-radius (always extract the actual mask shape)
- Logo transparency lost from jpg conversion (always use PNG for logos with transparency)
- **Logo variants reused incorrectly** — a single brand may use 2–4 distinct logo treatments across a site: a small horizontal lockup in the navbar, an icon-only mark in social cards, a larger lockup with stacked wordmark in the footer, a white version on dark backgrounds. **Do not reuse one `Logo` component across all of them.** Default to building a separate variant whenever the source section shows a different layout, scale, or composition for the logo. The navbar lockup almost never satisfies the footer's needs.
- **SVG curve/wave direction inverted** — concave-up vs concave-down on dividers is easy to get backwards. The quadratic Bézier control point's Y determines the dip direction: `Q midX, lowerY` makes the curve sag downward; `Q midX, upperY` makes it peak upward. After implementing, flip-test by swapping the Y to confirm the source matches your chosen direction.
- **Decorative element placement** — small accents (corner badges, regulator/award logos, social proof icons) are often the easiest to misplace. Source rules to capture before building: centered vs left/right, absolute vs flow, vertical alignment relative to the surrounding row.

### 15. The Most Important Insight

The highest-quality clones do NOT copy pixels. They reconstruct:

- layout intent
- design system logic
- spacing rhythm
- component semantics
- constraint behavior

A perfect clone is essentially reverse-engineering the original design system from rendered output.

## Step 12 — Auto-push to local Drupal (MANDATORY after green QC)

This is the final pipeline step, run after Steps 0–11 complete. Only proceed when ALL quality gates pass: `npx canvas validate --all && npx canvas build`,
visual diff, section diff, and content audit. Then push the result to the local DDEV-Canvas
site (the default target):

```bash
node website-to-components/scripts/push-local.js <url>
```

This pushes components, creates the main/footer/sidebar menus, creates or upserts pages,
publishes them, and prints the review URL. For `homepage` scope, menu links to pages that
were not built resolve to `#` automatically. If the script reports a readiness problem
(missing `CANVAS_LOCAL_*` or OAuth), fix it per the `canvas-push-local` skill and re-run.
Pages are upserted when revisions are enabled on the `page` bundle and skipped (with a
warning) when they are not, so re-runs never destroy unrecoverable content.
