# Evals for the migration skills

These evals test the migration-specific Claude skills this addon installs (e.g.
`migration-component-authoring`). They do **not** ship their own runner — they
run on top of the eval harness supplied by the
[`ai_best_practices`](https://www.drupal.org/project/ai_best_practices) Drupal
module, which must already be installed in the project.

## How the pieces fit together

| Piece | Provided by | Location |
| --- | --- | --- |
| Eval runner (`run-evals.py`, `providers.py`, `compare.py`) | `ai_best_practices` module | `web/vendor/drupal/ai_best_practices/evals/` |
| Per-eval payload (`fg-content-mapping/`, …) | **this addon** | `evals/` |
| Skill under test (e.g. `migration-component-authoring`) | **this addon** | project `.claude/skills/` |

The runner resolves every eval's `skill_file` path **relative to the module
root** (`web/vendor/drupal/ai_best_practices/`). The migration skills, however,
are installed by this addon into the **project's** `.claude/skills/`. Bridging
that gap requires two things: the eval payload copied into the module's `evals/`,
and the skill made reachable from the module root. The addon's `post-start` hook
does both automatically (see [Setup](#setup--automatic)).

## Prerequisites

- The [`ai_best_practices`](https://www.drupal.org/project/ai_best_practices)
  module installed via Composer (`composer require drupal/ai_best_practices`),
  so `web/vendor/drupal/ai_best_practices/evals/run-evals.py` exists.
- This addon installed (see the [top-level README](../../README.md)), so the
  migration skills exist under the project's `.claude/skills/`.
- `python3` available on the host.
- For **behavioral** cases: the `claude` CLI authenticated and on `PATH`, with
  image-reading tools enabled (the cases `Read` a screenshot). Static cases need
  neither.

## Setup — automatic

The wiring is handled for you, so **you normally don't run any of the commands in
this section**. Installing the addon copies the eval payloads into the project
(`evals/`), and a `post-start` hook then, on every `ddev restart`:

1. Copies each eval payload under `evals/` into the module's evals
   directory (`web/vendor/drupal/ai_best_practices/evals/`).
2. Points the module's `.claude/skills` at the project's installed `.claude/skills`
   with a relative symlink, so each eval's `skill_file` path resolves to the
   **installed** skill.

```bash
ddev add-on get FreelyGive/DDEV-migration-addon
ddev restart
```

The hook is idempotent and **self-healing**: if `drupal/ai_best_practices` is not
vendored yet when you install the addon, the hook is a no-op that turn — install
the module (`composer require drupal/ai_best_practices`) and `ddev restart`, and
it wires the evals up automatically. After that, jump straight to
[Run the evals](#run-the-evals).

### Manual re-sync (development only)

You only need this when you've edited an eval locally and want to push it into an
already-installed module without reinstalling the addon. From the project root:

```bash
ABP="web/vendor/drupal/ai_best_practices"

# 1. Copy each changed eval payload into the module's evals/ directory.
cp -r evals/fg-content-mapping "$ABP/evals/"

# 2. (Re)point the module's .claude/skills at the project's installed skills,
#    so skill_file paths resolve. Idempotent — safe to re-run.
mkdir -p "$ABP/.claude"
ln -sfn "$(pwd)/.claude/skills" "$ABP/.claude/skills"
```

The skill is **linked, not copied**, so the eval always tests the currently
installed skill — improvements to the skill show up on the next run with no
re-sync. The eval payload, by contrast, is copied, so changes to a case need
step 1.

> If your layout differs (no `web/` docroot, or the module vendored elsewhere),
> point `ABP` at wherever `ai_best_practices/evals/run-evals.py` lives. The only
> requirement is that `<module-root>/.claude/skills/<skill>/SKILL.md` resolves to
> the installed skill.

## Run the evals

All commands run from the module root:

```bash
cd web/vendor/drupal/ai_best_practices
```

### Static assertions (no API calls, CI-safe)

```bash
python3 evals/run-evals.py --static --skill fg-content-mapping
```

Structural checks against the skill file on disk — no model calls. Suitable for
CI.

### Behavioral cases (requires the `claude` CLI)

```bash
python3 evals/run-evals.py --behavioral --skill fg-content-mapping
```

The runner prepends the skill text to each prompt and runs the `claude` provider
in the module root, so the model can `Read` the fixture image + HTML shipped in
the eval directory.

### Strict per-field grading and reliability (recommended)

The substring assertions in the runner are a coarse gate. Each eval that needs a
true "100% correct" verdict ships its own strict grader (`grade.py`) plus a
ground-truth file. Run the suite N times and grade every field against ground
truth:

```bash
# from the module root, pointing at the copied eval payload
python3 evals/fg-content-mapping/grade.py --runs 5
```

It reports a per-case pass rate (e.g. `B03: 5/5`) and exits non-zero until every
case is 100% across all runs. Use `--grade-dir <dir>` to re-grade saved traces
without re-running the model.

## Available evals

- **`fg-content-mapping/`** — tests `migration-component-authoring`'s "Faithful
  content reproduction" rules: given a real source-section screenshot + its HTML,
  does the skill map it to complete, accurate component content (every person,
  every job title, the exact profile URLs, nothing invented)? See its
  [README](fg-content-mapping/README.md) for the ground truth and case details.

## Keeping the copies in sync

`ddev restart` re-copies the eval payloads into the module via the `post-start`
hook, so editing a case under `evals/` and restarting is enough to update
the module's working copy. The [manual re-sync](#manual-re-sync-development-only)
does the same thing without a restart. The skill link never needs redoing — it
tracks the installed skill live.

## Links

- This addon: <https://github.com/FreelyGive/DDEV-migration-addon>
- `ai_best_practices` module (the eval harness): <https://www.drupal.org/project/ai_best_practices>
- Canvas Storybook AI: <https://canvas.drupalstarforge.ai>
