// lib/timings.js
//
// Append-only timing log for the website-to-components pipeline. Used by:
//   - Automated Node jobs (call start/end around their run() bodies)
//   - The Claude Code agent (via scripts/log-timing.js CLI)
//
// Storage: one JSONL file per site at output/<host>/timings.jsonl. Each line
// is a single immutable record:
//   { stage, page, component, subagent, status, startedAt, endedAt, durationMs, meta }
//
// "stage"  — pipeline step label (e.g. "step-1-screenshot", "step-5-build")
// "page"   — page slug, or "site" for site-wide entries (sitemap, audit)
// "component" — component name when stage operates on a specific one
// "subagent" — short label of the parallel subagent that did the work
// "status" — "ok" | "fail" | "skip"
// "meta"   — free-form object (counts, file paths, error messages)

import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { sitePaths, ensureDir } from "./paths.js";

export function timingsPath(url) {
  const { siteDir } = sitePaths(url);
  ensureDir(siteDir);
  return join(siteDir, "timings.jsonl");
}

export function logTiming(url, entry) {
  const record = {
    ts: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(timingsPath(url), JSON.stringify(record) + "\n");
  return record;
}

// Convenience wrapper: time an async function and append start+end entries.
// Returns whatever fn() returns; on throw it still records `status: "fail"`.
export async function timed(url, label, fn, meta = {}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const result = await fn();
    const t1 = Date.now();
    logTiming(url, {
      ...label, // {stage, page?, component?, subagent?}
      startedAt,
      endedAt: new Date(t1).toISOString(),
      durationMs: t1 - t0,
      status: "ok",
      meta,
    });
    return result;
  } catch (e) {
    const t1 = Date.now();
    logTiming(url, {
      ...label,
      startedAt,
      endedAt: new Date(t1).toISOString(),
      durationMs: t1 - t0,
      status: "fail",
      meta: { ...meta, error: String(e?.message ?? e) },
    });
    throw e;
  }
}

// Read and parse the entire timings JSONL log for a site. Returns an array of
// records; lines that fail to parse are skipped.
export function readTimings(url) {
  const path = timingsPath(url);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}
