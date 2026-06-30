# Evals: fg-content-mapping

Tests for the `.claude/skills/migration-component-authoring/SKILL.md` skill —
specifically its "Faithful content reproduction — reproduce EVERY element,
invent NOTHING" rules. Can the skill reliably read a real source-section image
and map it to complete, accurate component content?

## Fixture

Both files are in this directory and **both are read by the model**:

- `passionate-professionals.png` — a screenshot of one website section: the
  "Meet our team of passionate professionals" team grid. Carries the layout,
  names, and job titles.
- `passionate-professionals.html` — the source HTML for that section. The exact
  profile URLs (LinkedIn / Drupal.org) live in the anchor `href`s here and are
  not legible in the image, so the model must read the HTML to reproduce them
  exactly. The eval measures whether the skill maps this source to complete,
  accurate component content — every person, every field, the real URLs, and
  nothing invented.

Ground truth (10 people) — exact profile URLs from the HTML:

| Name | Job title(s) | Profile links |
| --- | --- | --- |
| Jamie Abrahams | Director / Digital Architect / AI Consultant | https://www.drupal.org/u/yautja_cetanu · https://www.linkedin.com/in/james-abrahams-62ab0418/ |
| Andrew Belcher | Director / Lead Developer / System Administrator | https://www.drupal.org/u/andrewbelcher · https://www.linkedin.com/in/andrew-belcher-309561201/ |
| David Lynch | Director | https://uk.linkedin.com/in/david-lynch-7a87647 |
| Debbie Smith | Head of Delivery & Growth | https://www.linkedin.com/in/debbie-smith-2063934b/ |
| Catia Penas | Project Manager | https://www.drupal.org/u/catia_penas · https://www.linkedin.com/in/catiapenas/ |
| Yan Loetzer | Tech Lead | https://www.drupal.org/u/yanniboi |
| Jeremy Skinner | Developer | https://www.drupal.org/u/jeremyskinner |
| Mark Jones | Developer | https://www.drupal.org/u/justanothermark |
| Mark Berry | Developer | https://www.drupal.org/u/mjb3141 |
| Marcus Johansson | Developer | https://www.drupal.org/u/marcus_johansson |

Section title: **Meet our team of passionate professionals**. People count: **10**.

## Static assertions (no API calls, CI-safe)

```bash
python3 evals/run-evals.py --static --skill fg-content-mapping
```

13 checks: skill file exists, frontmatter has name + description, and the
faithful-content-reproduction guidance is present and correctly ordered —
"never invent", complete repeating-block lists, enumerate every block, extract
every field, the LinkedIn-link failure mode, no paraphrasing/borrowing from a
sibling, structural DOM extraction, and the element-inventory QA gate. The
"never invent" rule must precede the element-inventory gate (capture before
verify).

## Behavioral cases (requires claude CLI with image-reading tools)

```bash
python3 evals/run-evals.py --behavioral --skill fg-content-mapping
```

The runner prepends the skill text to each prompt and runs the `claude` provider
in the repo root, so the model can `Read` the fixture files itself. The prompts
are deliberately naive ("I'm migrating this section, give me its content as
JSON") — they specify only the output shape, not the extraction discipline, so a
pass reflects the **skill**, not coaching in the prompt. Three cases:

- **B01 — full roster JSON** (reads the image + HTML). Extract the section as a
  single JSON object (title, peopleCount, and a `people[]` array of
  `{name, jobTitles[], links[]}`) with the real profile URLs from the HTML.
  Checks an unguessable exact Drupal handle is present
  (`drupal.org/u/yautja_cetanu`), the count is not 8/9/11, no
  "for brevity / remaining members" truncation, and that no fabricated URLs
  appear (e.g. a LinkedIn URL for the Drupal-only people, or a Drupal handle for
  David/Debbie).
- **B02 — title, count, names** (reads the image). Plain `Field: value` answers.
  Checks the count is exactly 10 (rejects 8/9/11/12) and the title/first name
  are present.
- **B03 — per-person rows** (reads the image + HTML). One line per person with
  their own job title(s) and exact profile URLs. Checks an unguessable exact URL
  is present (`drupal.org/u/marcus_johansson`) and that fields are per-person and
  not borrowed from a sibling (e.g. Marcus Johansson must not be labelled
  "Director").

Note: the substring assertions are a coarse gate. For a true 100%-accuracy
verdict — every name, every title line, every link correct and nothing invented
— review the saved traces (`--output-dir`) against the ground-truth table above:

```bash
python3 evals/run-evals.py --behavioral --skill fg-content-mapping --output-dir ./traces
```

## A/B comparison

```bash
python3 evals/compare.py --skill fg-content-mapping --no-baseline --runs 3
```

Reports pass rate delta, token usage, and cost per question. See
[CONTRIBUTING.md](../../CONTRIBUTING.md) for details.
