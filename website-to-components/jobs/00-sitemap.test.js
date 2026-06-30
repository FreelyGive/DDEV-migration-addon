import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "00-sitemap.js"), "utf8");

// Regression guard for the menu-parse crash.
//
// The main-nav extractor is a JS string built with a TEMPLATE LITERAL and sent
// to `agent-browser eval` to run in the page. Any regex inside that string must
// double its backslashes (`\\s`, `\\/`), because the template literal consumes
// one level of escaping before the string ever reaches the browser. The footer
// and sidebar blocks had SINGLE-backslash regexes: `\s` collapsed to `s`
// (matching the letter 's', not whitespace) and — worse — `\/` collapsed to `/`
// so `replace(/\/+$/, '')` became `replace(//+$/, '')`, where `//` starts a line
// comment. That broke the statement and the browser threw
// `SyntaxError: Unexpected token 'const'`, which made parseBrowserJson() return
// null and the job `process.exit(1)` — killing the whole run before the handoff.
//
// Extract the eval template literal and assert no regex inside it uses a
// single-backslash `\s` or `\/` (the forms that silently collapse).

// Pull out the big backtick-delimited string passed to browserEval(`…`).
const evalMatch = SRC.match(/browserEval\(`([\s\S]*?)`\)/);

test("the menu-extractor eval template literal exists", () => {
  assert.ok(evalMatch, "could not find the browserEval(`…`) template literal");
});

test("every regex in the eval template literal escapes backslashes for the template layer", () => {
  const literal = evalMatch[1];

  // A single backslash followed by s, S, d, D, w, W, b, or / inside a regity
  // literal here is the bug: the template literal eats it. The correct form is
  // a DOUBLE backslash. Flag any lone `\<metachar>` that is not preceded by
  // another backslash.
  const offenders = [];
  const re = /(^|[^\\])\\([sSdDwWb/])/g; // \x not preceded by a backslash
  let m;
  for (const line of literal.split("\n")) {
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      offenders.push(`\\${m[2]}  in: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Single-backslash regex escapes found in the eval template literal — these collapse when the ` +
      `template literal is evaluated and corrupt the regex (\\/ becomes //, a comment). Double them:\n` +
      offenders.join("\n"),
  );
});

test("the eval literal does not contain a '//' that would comment out code (collapsed \\/)", () => {
  const literal = evalMatch[1];
  // The signature of the original crash: replace(//+$/  — a collapsed /\/+$/.
  assert.ok(
    !/replace\(\/\/\+/.test(literal),
    "found `replace(//+` — a `/\\/+$/` regex whose backslash collapsed into a line comment",
  );
});
