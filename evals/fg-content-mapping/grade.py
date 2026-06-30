#!/usr/bin/env python3
"""Strict per-field grader + multi-run reliability harness for fg-content-mapping.

The substring assertions in evals.json are a coarse gate — they can pass on
subtly-wrong output. This grader checks EVERY field of the response against
ground-truth.json: the section title, the exact people count, every person's
name, every job-title line, and every profile URL. A case "passes" only when it
is 100% correct.

Usage:
    python3 grade.py --runs 5
        Runs the behavioral suite --runs times (each into its own trace dir),
        grades every trace strictly, and prints a per-case pass rate.

    python3 grade.py --grade-dir <dir>
        Grades already-saved traces in <dir> (one <CID>.json per case) without
        re-running the model.

Run from anywhere; paths resolve relative to this file.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVALS_REPO = HERE.parent.parent          # .../testing1
RUN_EVALS = EVALS_REPO / "evals" / "run-evals.py"
SKILL = "fg-content-mapping"
GROUND_TRUTH = json.loads((HERE / "ground-truth.json").read_text())


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def norm_url(u: str) -> str:
    """Canonical URL form for comparison: lowercase, no trailing slash, no scheme/host noise."""
    u = u.strip().lower().rstrip("/")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^(www\.|uk\.)", "", u)
    return u


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


GT_TITLE = norm_text(GROUND_TRUTH["title"])
GT_COUNT = GROUND_TRUTH["peopleCount"]
GT_PEOPLE = {
    norm_text(p["name"]): {
        "titles": {norm_text(t) for t in p["jobTitles"]},
        "links": {norm_url(u) for u in p["links"]},
    }
    for p in GROUND_TRUTH["people"]
}
ALL_GT_LINKS = {u for p in GT_PEOPLE.values() for u in p["links"]}


# ---------------------------------------------------------------------------
# Response parsing — pull a {name -> {titles, links}} map out of any format
# ---------------------------------------------------------------------------

def extract_people_from_json(resp: str):
    """If the response has a JSON object with a people[] array, parse it."""
    for m in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", resp, re.DOTALL):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and isinstance(data.get("people"), list):
            return data
    # bare JSON (no fence)
    m = re.search(r"\{.*\"people\".*\}", resp, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


def collect_response(resp: str) -> dict:
    """Return {title, count, people:{name->{titles,links}}} as best parsed from any format.

    Works for JSON roster (B01), 'Field: value' (B02), and pipe rows (B03).
    Links/titles are matched against ground truth by membership, so even a flat
    text response is graded per-person via name anchoring.
    """
    out = {"title": None, "count": None, "people": {}}

    # Title: ground-truth title appears verbatim somewhere.
    if GT_TITLE in norm_text(resp):
        out["title"] = GT_TITLE

    # Count: look for an explicit number near 'count'/'peopleCount', else infer.
    cm = re.search(r'(?:"?peoplecount"?|count)\D{0,4}(\d{1,3})', resp, re.I)
    if cm:
        out["count"] = int(cm.group(1))

    data = extract_people_from_json(resp)
    if data and isinstance(data.get("people"), list):
        out["title"] = GT_TITLE if (data.get("title") and norm_text(str(data["title"])) == GT_TITLE) else out["title"]
        if isinstance(data.get("peopleCount"), int):
            out["count"] = data["peopleCount"]
        for p in data["people"]:
            name = norm_text(str(p.get("name", "")))
            if not name:
                continue
            titles = {norm_text(str(t)) for t in (p.get("jobTitles") or p.get("jobTitle") or []) if str(t).strip()}
            links = {norm_url(str(u)) for u in (p.get("links") or []) if str(u).strip()}
            out["people"][name] = {"titles": titles, "links": links}
        if out["count"] is None:
            out["count"] = len(data["people"])
        return out

    # Non-JSON: anchor on each ground-truth name, scan the line(s) it appears on.
    lines = resp.splitlines()
    for gt_name in GT_PEOPLE:
        titles, links = set(), set()
        for ln in lines:
            if gt_name in norm_text(ln):
                links |= {norm_url(u) for u in re.findall(r'https?://[^\s|,"\')]+', ln)}
                # titles: any ground-truth title string present on the line
                for gt_t in GT_PEOPLE[gt_name]["titles"]:
                    if gt_t in norm_text(ln):
                        titles.add(gt_t)
        if any(gt_name in norm_text(ln) for ln in lines):
            out["people"][gt_name] = {"titles": titles, "links": links}
    if out["count"] is None:
        out["count"] = len(out["people"]) or None
    return out


# ---------------------------------------------------------------------------
# Strict grading per case
# ---------------------------------------------------------------------------

def grade_case(cid: str, resp: str) -> tuple[bool, list[str]]:
    """Return (passed, list_of_failures). What's checked depends on the case's scope."""
    parsed = collect_response(resp)
    fails = []

    # Title — required for B01, B02.
    if cid in ("B01", "B02"):
        if parsed["title"] != GT_TITLE:
            fails.append(f"title wrong/missing (got {parsed['title']!r})")

    # Count — required for B01, B02.
    if cid in ("B01", "B02"):
        if parsed["count"] != GT_COUNT:
            fails.append(f"count != {GT_COUNT} (got {parsed['count']})")

    # Names present — all cases must mention all 10.
    missing_names = [n for n in GT_PEOPLE if n not in parsed["people"]]
    if missing_names:
        fails.append(f"missing people: {sorted(missing_names)}")

    # Per-person titles — B01 and B03 carry titles.
    if cid in ("B01", "B03"):
        for n, gt in GT_PEOPLE.items():
            got = parsed["people"].get(n, {}).get("titles", set())
            if got != gt["titles"]:
                fails.append(f"{n}: titles {sorted(got)} != {sorted(gt['titles'])}")

    # Per-person links — B01 and B03 carry exact URLs.
    if cid in ("B01", "B03"):
        for n, gt in GT_PEOPLE.items():
            got = parsed["people"].get(n, {}).get("links", set())
            if got != gt["links"]:
                missing = sorted(gt["links"] - got)
                extra = sorted(got - gt["links"])
                fails.append(f"{n}: links wrong (missing {missing}, extra {extra})")

    return (len(fails) == 0, fails)


CASE_IDS = ["B01", "B02", "B03"]


def grade_dir(trace_dir: Path) -> dict[str, tuple[bool, list[str]]]:
    results = {}
    for cid in CASE_IDS:
        f = trace_dir / f"{cid}.json"
        if not f.exists():
            results[cid] = (False, [f"no trace file {f.name}"])
            continue
        resp = json.loads(f.read_text()).get("response", "")
        results[cid] = grade_case(cid, resp)
    return results


def run_once(run_idx: int) -> Path:
    out = HERE / "traces" / f"run-{run_idx:02d}"
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [sys.executable, str(RUN_EVALS), "--behavioral", "--skill", SKILL,
         "--output-dir", str(out)],
        cwd=str(EVALS_REPO), check=False,
    )
    # runner nests by skill name
    nested = out / SKILL
    return nested if nested.exists() else out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--grade-dir", default=None,
                    help="Grade existing traces in this dir instead of running")
    args = ap.parse_args()

    if args.grade_dir:
        res = grade_dir(Path(args.grade_dir))
        for cid in CASE_IDS:
            ok, fails = res[cid]
            print(f"{cid}: {'PASS' if ok else 'FAIL'}")
            for fl in fails:
                print(f"    - {fl}")
        sys.exit(0 if all(ok for ok, _ in res.values()) else 1)

    tally = {cid: 0 for cid in CASE_IDS}
    for i in range(1, args.runs + 1):
        print(f"\n===== RUN {i}/{args.runs} =====")
        d = run_once(i)
        res = grade_dir(d)
        for cid in CASE_IDS:
            ok, fails = res[cid]
            print(f"  {cid}: {'PASS' if ok else 'FAIL'}")
            for fl in fails:
                print(f"      - {fl}")
            if ok:
                tally[cid] += 1

    print("\n===== RELIABILITY ({} runs) =====".format(args.runs))
    all_perfect = True
    for cid in CASE_IDS:
        rate = tally[cid]
        print(f"  {cid}: {rate}/{args.runs}")
        if rate != args.runs:
            all_perfect = False
    print("\n  RESULT:", "100% reliable across all cases" if all_perfect
          else "NOT yet 100% — see failures above")
    sys.exit(0 if all_perfect else 1)


if __name__ == "__main__":
    main()
