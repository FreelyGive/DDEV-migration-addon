# Migration Flow — Remaining Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two unbuilt pieces of the approved 2026-06-24 migration-flow redesign so `ddev clone <url>` reaches a running site with zero manual steps: (A) an active, idempotent Drupal permission/OAuth/revisions bootstrap, and (B) real claude-seo `seo-sitemap` Mode 1 integration for whole-site discovery.

**Architecture:** All work lands in `DDEV-migration-addon` (branch `feature/migration-flow`). Gap A adds a DDEV command (`ddev canvas-bootstrap`) backed by a drush/PHP-eval script run inside the web container, invoked automatically from the `clone` command before `run.js`. Gap B replaces the plain-`fetch` whole-site URL source in `run.js` with a claude-seo-backed fetcher that returns only HTTP-200, indexable, canonical URLs, keeping `00b-sitemap-xml.js` as the parser/fallback. Pure logic stays unit-testable with injected I/O (the existing pattern); shell/drush glue is verified by invoking it against the local DDEV-Canvas site.

**Tech Stack:** Node.js ESM (`node:test`), DDEV custom commands (bash), Drupal `drush` + PHP `eval`, JSON:API/OAuth (Simple OAuth + `consumers` module), claude-seo `seo-sitemap` skill (Python 3.10+).

## Global Constraints

- All file paths below are relative to the repo root `/Users/nickopris/Work/fg/projects/ddev-addons/DDEV-migration-addon` unless absolute.
- Branch: `feature/migration-flow`. Commit after every task. This branch has no upstream; do not push.
- Tests run with: `cd website-to-components && node --test test/*.test.mjs` — must stay green (31 tests passing today; this plan adds more).
- Bootstrap MUST be idempotent: every step is check-then-act, safe to re-run, no duplicate OAuth clients / menus / revisions flips.
- OAuth scope string is exactly `canvas:asset_library canvas:js_component member` (verbatim, matches `lib/jsonapi.js:5` `FULL_SCOPE`).
- `.env` lives at the **storybook** project's `.env` (`storybook/.env`), and uses keys `CANVAS_LOCAL_SITE_URL`, `CANVAS_LOCAL_CLIENT_ID`, `CANVAS_LOCAL_CLIENT_SECRET` (verbatim, matches `lib/bootstrap-check.js:1`). **`CANVAS_LOCAL_SITE_URL` is the PUBLIC `.ddev.site` URL** (e.g. `https://weber2.ddev.site`) — this is what the working `canvas:push:local` script in `storybook/package.json` passes to `canvas push --site-url`. Do NOT write the container-internal `http://web/web` URL; that breaks the existing push. There is also a `CANVAS_LOCAL_JSONAPI_PREFIX` key (value `jsonapi`) already present in working `.env` files — preserve it; bootstrap must not delete or change it.
- **Consumer idempotency = reuse-any-valid-consumer, not own-a-named-one.** Working sites already have a functional consumer (e.g. `client_id=canvas-ai-eee`). Bootstrap must (1) verify whether a usable consumer already exists — assigned user + Client Credentials grant + the required scopes — and reuse it if so (emit its existing client_id/secret), and only (2) create a dedicated `canvas_migration` consumer when no usable one exists. Never overwrite or duplicate a working consumer.
- Whole-site scope: **menus always come from nav extraction; the page set comes from the sitemap** (design Subsystem 2). Do not derive menus from the sitemap.
- No blind crawler. If no sitemap is found, fall back to menu-reachable + warn (existing `discoverSiteUrls` behavior — preserve it).
- claude-seo is a hard dependency only for `--scope site`. If it is absent at run time, warn and fall back to menu-reachable (do not hard-fail the whole run).

---

## File Structure

**Gap A — Permission bootstrap (new + modified):**
- Create: `commands/web/canvas-bootstrap` — DDEV web-container command; runs the bootstrap PHP/drush script inside the container, idempotent, writes `.env`.
- Create: `website-to-components/scripts/bootstrap-canvas.php` — drush `php:script` payload: enables JSON:API write, creates/updates the OAuth consumer, assigns a service user, enables `page` revisions. Emits the client_id/secret as JSON on stdout.
- Modify: `commands/nodejs/clone` — call `ddev canvas-bootstrap` (idempotent) before `node scripts/run.js`.
- Modify: `install.yaml` — register `commands/web/canvas-bootstrap`; document that bootstrap runs automatically.
- Modify: `README.md` — document `ddev canvas-bootstrap` and the auto-bootstrap behavior.

**Gap B — claude-seo whole-site discovery (new + modified):**
- Create: `website-to-components/lib/seo-sitemap.js` — wrapper that shells out to the claude-seo `seo-sitemap` skill (Mode 1), parses its output to a validated URL list, with injected `runSkill`/`isInstalled` for testability.
- Modify: `website-to-components/scripts/run.js` — build `fetchXml`/site-URL source from `lib/seo-sitemap.js` when scope is `site`; keep plain fetch fallback.
- Modify: `website-to-components/jobs/00b-sitemap-xml.js` — accept an optional pre-validated URL list (from claude-seo) and skip raw parsing when present; keep parser + fallback otherwise.
- Create/modify tests under `website-to-components/test/`.

---

## Gap A — Active Permission Bootstrap

### Task A1: Bootstrap PHP script — JSON:API write + page revisions

**Files:**
- Create: `website-to-components/scripts/bootstrap-canvas.php`
- Test: manual drush invocation against local DDEV-Canvas (no unit test — this is Drupal-runtime glue; verified by running it twice and observing idempotency).

**Interfaces:**
- Produces: a drush-runnable PHP script. When run via `drush php:script`, it (1) sets JSON:API to read/write, (2) enables `new_revision` on the `page` node type, and prints progress lines prefixed `[bootstrap]`. Later tasks (A2) extend the same file with OAuth client creation; A1 covers only the two config flips so each piece is independently testable.

- [ ] **Step 1: Write the script (config flips only)**

Create `website-to-components/scripts/bootstrap-canvas.php`:

```php
<?php

/**
 * Idempotent Canvas migration bootstrap.
 * Run inside the web container with:
 *   drush php:script website-to-components/scripts/bootstrap-canvas.php
 *
 * Check-then-act throughout: safe to re-run. Prints [bootstrap] progress lines.
 * Task A2 extends this with OAuth consumer + service-user creation.
 */

use Drupal\Core\Entity\EntityStorageException;

function bootstrap_log(string $msg): void {
  fwrite(STDOUT, "[bootstrap] $msg\n");
}

// 1. JSON:API: read/write.
$jsonapi = \Drupal::configFactory()->getEditable('jsonapi.settings');
if ($jsonapi->get('read_only') !== FALSE) {
  $jsonapi->set('read_only', FALSE)->save();
  bootstrap_log('JSON:API set to read/write.');
}
else {
  bootstrap_log('JSON:API already read/write.');
}

// 2. Enable revisions on the page node type by default.
$page_type = \Drupal::entityTypeManager()->getStorage('node_type')->load('page');
if ($page_type && !$page_type->shouldCreateNewRevision()) {
  $page_type->setNewRevision(TRUE);
  $page_type->save();
  bootstrap_log('Enabled new_revision on the page node type.');
}
elseif ($page_type) {
  bootstrap_log('Page revisions already enabled.');
}
else {
  bootstrap_log('WARNING: page node type not found — skipping revisions.');
}
```

- [ ] **Step 2: Run it against local DDEV-Canvas to verify**

Run (from the migration project root that has DDEV-Canvas):
```bash
ddev drush php:script website-to-components/scripts/bootstrap-canvas.php
```
Expected stdout includes `[bootstrap] JSON:API set to read/write.` (or "already read/write") and a `page` revisions line. Confirm at `/admin/config/services/jsonapi` that "Accept all JSON:API create, read, update, and delete operations" is selected.

- [ ] **Step 3: Run it again to verify idempotency**

Run the same command. Expected: both lines now say "already" (no second mutation, no error).

- [ ] **Step 4: Commit**

```bash
git add website-to-components/scripts/bootstrap-canvas.php
git commit -m "feat(migration): bootstrap script — JSON:API write + page revisions (idempotent)"
```

---

### Task A2: Bootstrap PHP script — OAuth consumer + service user

**Files:**
- Modify: `website-to-components/scripts/bootstrap-canvas.php` (append before end of file)

**Interfaces:**
- Consumes: the `consumers` + `simple_oauth` modules (ship with Canvas/Drupal recipe). Assumes a signing key already exists (Canvas install provides it).
- Produces: when run, guarantees a usable Client-Credentials consumer exists with scopes `canvas:asset_library canvas:js_component member` **and a Drupal user assigned**, REUSING any existing usable consumer rather than duplicating it. Prints a final JSON line `[bootstrap-result] {"client_id":"...","client_secret":"<value-or-__keep__>","site_url":"...","jsonapi_prefix":"jsonapi"}` consumed by Task A3.
- **Secret-recovery constraint (discovered against the live site):** Drupal hashes consumer secrets on save, so the plaintext secret of a *pre-existing* consumer cannot be read back. Therefore: when reusing an existing consumer, emit `"client_secret":"__keep__"` to signal "do not change the secret already in `.env`". Only when the script *creates or resets* a consumer does it know the plaintext and emit it.

- [ ] **Step 1: Append consumer-reuse + service-user logic**

First, confirm the consumer entity field names on the live site (do this before writing — the array keys below must match):

```bash
ddev drush ev '$f=\Drupal::entityTypeManager()->getStorage("consumer")->create([])->getFieldDefinitions(); echo implode(",", array_keys($f));'
```
Expected to include: `client_id`, `secret`, `grant_types`, `scopes`, `user_id`. If a name differs on this `consumers` version, use the live name throughout.

Append to `website-to-components/scripts/bootstrap-canvas.php` (no closing `?>`):

```php

// Required scope machine names. Adjust if the live scope entity ids differ
// (verify: ddev drush ev '...oauth2_token... ' or the consumer "scopes" field
// allowed values). These three match lib/jsonapi.js FULL_SCOPE.
$required_scopes = ['canvas:asset_library', 'canvas:js_component', 'member'];

// The public site URL the storybook push uses (CANVAS_LOCAL_SITE_URL). Derive
// from the request base; for DDEV this is https://<project>.ddev.site. We read
// it from the DDEV_PRIMARY_URL env if present, else fall back to a global the
// installer can set. NEVER emit the container-internal http://web/web here —
// the storybook `canvas push --site-url` needs the public URL.
$site_url = getenv('DDEV_PRIMARY_URL') ?: getenv('CANVAS_LOCAL_SITE_URL') ?: '';
if ($site_url === '') {
  bootstrap_log('WARNING: could not determine public site URL; emitting __keep__ so .env is left unchanged.');
  $site_url = '__keep__';
}

$consumer_storage = \Drupal::entityTypeManager()->getStorage('consumer');
$user_storage = \Drupal::entityTypeManager()->getStorage('user');

/**
 * A consumer is "usable" if it has Client Credentials, all required scopes,
 * and a user assigned. Returns TRUE/FALSE.
 */
$is_usable = function ($consumer) use ($required_scopes) {
  $grants = array_column($consumer->get('grant_types')->getValue(), 'value');
  if (!in_array('client_credentials', $grants, TRUE)) {
    return FALSE;
  }
  $scopes = array_column($consumer->get('scopes')->getValue(), 'target_id') ?:
            array_column($consumer->get('scopes')->getValue(), 'value');
  foreach ($required_scopes as $needed) {
    if (!in_array($needed, $scopes, TRUE)) {
      return FALSE;
    }
  }
  $uid = $consumer->get('user_id')->target_id;
  return !empty($uid);
};

// 3. Try to REUSE any already-usable consumer (do not disturb a working setup).
$reused = NULL;
foreach ($consumer_storage->loadMultiple() as $candidate) {
  if ($is_usable($candidate)) {
    $reused = $candidate;
    break;
  }
}

if ($reused) {
  // Cannot read the existing secret (hashed) — signal "keep .env secret".
  bootstrap_log('Reusing existing usable consumer "' . $reused->label() . '" (client_id=' . $reused->getClientId() . ').');
  fwrite(STDOUT, '[bootstrap-result] ' . json_encode([
    'client_id' => $reused->getClientId(),
    'client_secret' => '__keep__',
    'site_url' => $site_url,
    'jsonapi_prefix' => 'jsonapi',
  ]) . "\n");
}
else {
  // 3b. No usable consumer — create a dedicated one with a known plaintext secret.
  $existing_users = $user_storage->loadByProperties(['name' => 'canvas_migration']);
  $service_user = $existing_users ? reset($existing_users) : NULL;
  if (!$service_user) {
    $service_user = $user_storage->create(['name' => 'canvas_migration', 'status' => 1, 'roles' => ['administrator']]);
    $service_user->save();
    bootstrap_log('Created service user "canvas_migration".');
  }
  else {
    bootstrap_log('Service user "canvas_migration" already exists.');
  }

  // Stable derived secret so re-creation (e.g. after a manual delete) is idempotent.
  $secret = 'canvas-migration-' . substr(hash('sha256', \Drupal::service('settings')->get('hash_salt') . 'canvas-migration'), 0, 32);

  $owned = $consumer_storage->loadByProperties(['label' => 'Canvas Migration']);
  $consumer = $owned ? reset($owned) : NULL;
  if (!$consumer) {
    $consumer = $consumer_storage->create([
      'label' => 'Canvas Migration',
      'client_id' => 'canvas_migration',
      'secret' => $secret,
      'grant_types' => ['client_credentials'],
      'scopes' => $required_scopes,
      'user_id' => $service_user->id(),
    ]);
    $consumer->save();
    bootstrap_log('Created OAuth consumer "Canvas Migration".');
  }
  else {
    $consumer->set('grant_types', ['client_credentials']);
    $consumer->set('scopes', $required_scopes);
    $consumer->set('user_id', $service_user->id());
    $consumer->set('secret', $secret);
    $consumer->save();
    bootstrap_log('Reset OAuth consumer "Canvas Migration" (scopes + user + secret).');
  }

  fwrite(STDOUT, '[bootstrap-result] ' . json_encode([
    'client_id' => $consumer->getClientId(),
    'client_secret' => $secret,
    'site_url' => $site_url,
    'jsonapi_prefix' => 'jsonapi',
  ]) . "\n");
}
```

> NOTE for the implementer: the `scopes` field may store values as `target_id` (entity reference to `oauth2_scope`) OR `value` (string) depending on the simple_oauth version — the `$is_usable` closure checks both. Verify which by running `ddev drush ev '...->get("scopes")->getValue()...'` on a working consumer and keep only the correct one if you want to tidy. Do NOT set `is_default` — leaving it unset avoids hijacking the site's default consumer.

- [ ] **Step 2: Run it against weber2 and capture the result line**

```bash
cd /Users/nickopris/Work/fg/migrations/weberfr/weber2
# Copy the in-progress script into this project for testing (it is not installed via addon yet):
cp /Users/nickopris/Work/fg/projects/ddev-addons/DDEV-migration-addon/website-to-components/scripts/bootstrap-canvas.php website-to-components/scripts/bootstrap-canvas.php
ddev drush php:script website-to-components/scripts/bootstrap-canvas.php
```
Expected: since weber2 already has a working consumer (`canvas-ai-eee`), the script logs `Reusing existing usable consumer ...` and emits `"client_secret":"__keep__"` with `"site_url":"https://weber2.ddev.site"`.

- [ ] **Step 3: Verify the existing OAuth token still works (reuse path)**

```bash
cd /Users/nickopris/Work/fg/migrations/weberfr/weber2
CID=$(grep '^CANVAS_LOCAL_CLIENT_ID=' storybook/.env | cut -d= -f2)
CSECRET=$(grep '^CANVAS_LOCAL_CLIENT_SECRET=' storybook/.env | cut -d= -f2)
ddev exec curl -s -X POST https://weber2.ddev.site/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$CID&client_secret=$CSECRET&scope=canvas:asset_library canvas:js_component member" | head -c 200
```
Expected: JSON containing `"access_token"` (the reused consumer authenticates). A `401` means weber2's consumer was not actually usable — then the script should have taken the *create* path instead; investigate `$is_usable`.

- [ ] **Step 4: Run twice; verify NO new consumer was created on the reuse path**

```bash
cd /Users/nickopris/Work/fg/migrations/weberfr/weber2
BEFORE=$(ddev drush ev 'echo count(\Drupal::entityTypeManager()->getStorage("consumer")->loadMultiple());')
ddev drush php:script website-to-components/scripts/bootstrap-canvas.php >/dev/null
AFTER=$(ddev drush ev 'echo count(\Drupal::entityTypeManager()->getStorage("consumer")->loadMultiple());')
echo "consumers before=$BEFORE after=$AFTER"
```
Expected: `before == after` (reuse created nothing). Clean up the test copy afterward: `rm website-to-components/scripts/bootstrap-canvas.php` in weber2 (it is git-untracked there).

- [ ] **Step 5: Commit**

```bash
git add website-to-components/scripts/bootstrap-canvas.php
git commit -m "feat(migration): bootstrap OAuth consumer + assigned service user (idempotent)"
```

---

### Task A3: `ddev canvas-bootstrap` command — run script + write storybook/.env

**Files:**
- Create: `commands/web/canvas-bootstrap`
- Test: manual — run `ddev canvas-bootstrap` twice, inspect `storybook/.env`.

**Interfaces:**
- Consumes: `bootstrap-canvas.php` (Task A2) `[bootstrap-result]` JSON line.
- Produces: a `ddev canvas-bootstrap` command that runs the script inside the web container and writes/updates `storybook/.env` with `CANVAS_LOCAL_SITE_URL`, `CANVAS_LOCAL_CLIENT_ID`, `CANVAS_LOCAL_CLIENT_SECRET`, `CANVAS_LOCAL_JSONAPI_PREFIX` (only those keys; preserves other lines). **When the script emits `client_secret` or `site_url` as the sentinel `__keep__`, that key is LEFT UNCHANGED in `.env`** (reuse path — we cannot recover an existing consumer's hashed secret, and must not blank it). Exit 0 on success.

- [ ] **Step 1: Write the command**

Create `commands/web/canvas-bootstrap` (DDEV `web` commands run inside the web container):

```bash
#!/bin/bash
## Description: Bootstrap Canvas migration permissions (JSON:API write, OAuth client, service user, page revisions) — idempotent
## Usage: canvas-bootstrap
## Example: ddev canvas-bootstrap

set -euo pipefail

SCRIPT="/var/www/html/website-to-components/scripts/bootstrap-canvas.php"
ENV_FILE="/var/www/html/storybook/.env"

echo "==> Bootstrapping Canvas migration permissions (idempotent)..."
OUT="$(drush php:script "$SCRIPT")"
echo "$OUT" | grep '^\[bootstrap\]' || true

RESULT="$(echo "$OUT" | sed -n 's/^\[bootstrap-result\] //p' | tail -n1)"
if [ -z "$RESULT" ]; then
  echo "✗ Bootstrap produced no result line. See output above." >&2
  exit 1
fi

CLIENT_ID="$(echo "$RESULT"     | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')"
CLIENT_SECRET="$(echo "$RESULT" | sed -n 's/.*"client_secret":"\([^"]*\)".*/\1/p')"
SITE_URL="$(echo "$RESULT"      | sed -n 's/.*"site_url":"\([^"]*\)".*/\1/p')"
JSONAPI_PREFIX="$(echo "$RESULT"| sed -n 's/.*"jsonapi_prefix":"\([^"]*\)".*/\1/p')"

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

# Upsert one key without clobbering unrelated lines. The sentinel value
# "__keep__" means: leave whatever is already in .env untouched (reuse path).
upsert_env() {
  local key="$1" val="$2"
  if [ "$val" = "__keep__" ] || [ -z "$val" ]; then
    echo "  (keeping existing ${key})"
    return 0
  fi
  if grep -q "^${key}=" "$ENV_FILE"; then
    grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  echo "${key}=${val}" >> "$ENV_FILE"
}

upsert_env "CANVAS_LOCAL_SITE_URL"      "$SITE_URL"
upsert_env "CANVAS_LOCAL_CLIENT_ID"     "$CLIENT_ID"
upsert_env "CANVAS_LOCAL_CLIENT_SECRET" "$CLIENT_SECRET"
upsert_env "CANVAS_LOCAL_JSONAPI_PREFIX" "$JSONAPI_PREFIX"

echo "✓ Updated CANVAS_LOCAL_* in storybook/.env (kept __keep__ values)"
echo "✓ Canvas migration bootstrap complete."
```

- [ ] **Step 2: Make the command discoverable + run it (against weber2)**

```bash
# The command is not yet installed via the addon. Test it by copying into weber2's .ddev:
mkdir -p /Users/nickopris/Work/fg/migrations/weberfr/weber2/.ddev/commands/web
cp commands/web/canvas-bootstrap /Users/nickopris/Work/fg/migrations/weberfr/weber2/.ddev/commands/web/canvas-bootstrap
chmod +x /Users/nickopris/Work/fg/migrations/weberfr/weber2/.ddev/commands/web/canvas-bootstrap
# Also ensure the bootstrap script copy from Task A2 is present in weber2.
cd /Users/nickopris/Work/fg/migrations/weberfr/weber2
ddev canvas-bootstrap
```
Expected: `[bootstrap]` lines, a `(keeping existing CANVAS_LOCAL_CLIENT_SECRET)` line (reuse path), then `✓ Updated CANVAS_LOCAL_* ...` and `✓ Canvas migration bootstrap complete.`

- [ ] **Step 3: Inspect `storybook/.env` — confirm working values preserved**

```bash
ddev exec grep '^CANVAS_LOCAL_' /var/www/html/storybook/.env
```
Expected: `CANVAS_LOCAL_SITE_URL=https://weber2.ddev.site`, the pre-existing `CANVAS_LOCAL_CLIENT_ID`/`CANVAS_LOCAL_CLIENT_SECRET` UNCHANGED, and `CANVAS_LOCAL_JSONAPI_PREFIX=jsonapi`.

- [ ] **Step 4: Run again; verify no duplicate env lines**

```bash
ddev canvas-bootstrap
ddev exec sh -c "grep -c '^CANVAS_LOCAL_CLIENT_ID=' /var/www/html/storybook/.env"
```
Expected: prints `1` (upsert did not append a duplicate). Clean up test copies in weber2 afterward (`.ddev/commands/web/canvas-bootstrap` and `website-to-components/scripts/bootstrap-canvas.php` — both git-untracked there).

- [ ] **Step 5: Commit**

```bash
git add commands/web/canvas-bootstrap
git commit -m "feat(migration): ddev canvas-bootstrap command — run bootstrap + upsert storybook/.env"
```

---

### Task A4: Auto-invoke bootstrap from `clone` + register in install.yaml + README

**Files:**
- Modify: `commands/nodejs/clone`
- Modify: `install.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ddev canvas-bootstrap` (Task A3).
- Produces: `ddev clone <url>` runs bootstrap first (idempotent, non-fatal warning if it fails), then the existing pipeline. `install.yaml` ships `commands/web/canvas-bootstrap`.

- [ ] **Step 1: Call bootstrap from the clone command**

In `commands/nodejs/clone`, insert before the final `cd .../website-to-components` block. The current tail is:

```bash
shift  # remaining args passed through to run.js

cd /var/www/html/website-to-components
node scripts/run.js "$URL" "$@"
```

Replace it with:

```bash
shift  # remaining args passed through to run.js

# Idempotent permission bootstrap (JSON:API write, OAuth client, service user,
# page revisions, storybook/.env). Non-fatal: a warning here should not block
# screenshots/discovery, only the later auto-push.
if command -v ddev-canvas-bootstrap >/dev/null 2>&1 || [ -x "/var/www/html/.ddev/commands/web/canvas-bootstrap" ]; then
  echo "==> Preflight: Canvas permission bootstrap"
  bash /var/www/html/.ddev/commands/web/canvas-bootstrap || echo "⚠ Bootstrap reported a problem; continuing. Auto-push may be skipped."
else
  echo "⚠ canvas-bootstrap command not found; skipping permission bootstrap."
fi

cd /var/www/html/website-to-components
node scripts/run.js "$URL" "$@"
```

> NOTE: `commands/nodejs/clone` runs in the **nodejs** container; the `web` command file is mounted at `/var/www/html/.ddev/commands/web/canvas-bootstrap`. If that path differs on the live project, adjust to the actual mounted location (verify with `ddev exec ls /var/www/html/.ddev/commands/web/`).

- [ ] **Step 2: Register the command in install.yaml**

In `install.yaml`, add to `project_files:` (after `commands/nodejs/clone`):

```yaml
  - commands/web/canvas-bootstrap
```

And update the post-install echo block — replace the line:

```yaml
    - "echo 'Then use: ddev clone https://your-site.com'"
```

with:

```yaml
    - "echo 'Then use: ddev clone https://your-site.com'"
    - "echo 'Permissions are bootstrapped automatically on first clone (ddev canvas-bootstrap).'"
```

- [ ] **Step 3: Document in README.md**

Add a short section to `README.md` after the usage instructions:

```markdown
## Permission bootstrap

`ddev clone` runs `ddev canvas-bootstrap` automatically before discovery. It is
idempotent and:

- enables JSON:API read/write,
- creates the `Canvas Migration` OAuth consumer (Client Credentials, scopes
  `canvas:asset_library canvas:js_component member`),
- assigns the `canvas_migration` service user to that consumer (without this the
  Canvas REST API returns 401),
- enables revisions on the `page` content type (so re-runs upsert safely),
- writes `CANVAS_LOCAL_SITE_URL` / `CANVAS_LOCAL_CLIENT_ID` /
  `CANVAS_LOCAL_CLIENT_SECRET` into `storybook/.env`.

Run it on its own at any time with `ddev canvas-bootstrap`.
```

- [ ] **Step 4: End-to-end smoke against a clean local project**

On a freshly installed DDEV-Canvas project with this addon, run:
```bash
ddev clone https://example.com --scope homepage --no-mobile
```
Expected: output starts with `==> Preflight: Canvas permission bootstrap`, then `[bootstrap]` lines, then the existing `[1/6] Desktop screenshot` flow. `storybook/.env` contains the three CANVAS_LOCAL_* keys.

- [ ] **Step 5: Commit**

```bash
git add commands/nodejs/clone install.yaml README.md
git commit -m "feat(migration): auto-bootstrap permissions on ddev clone; register command + docs"
```

---

## Gap B — claude-seo `seo-sitemap` Mode 1 Integration

### Task B1: `lib/seo-sitemap.js` — invoke skill, parse validated URLs (TDD)

**Files:**
- Create: `website-to-components/lib/seo-sitemap.js`
- Test: `website-to-components/test/seo-sitemap.test.mjs`

**Interfaces:**
- Produces: `export async function discoverWithSeoSitemap({ origin, runSkill, isInstalled, log })` → `{ source: "seo-sitemap" | "unavailable", urls: string[] }`.
  - `isInstalled()` → `Promise<boolean>`: whether the claude-seo `seo-sitemap` skill is available.
  - `runSkill(origin)` → `Promise<string>`: invokes the skill in Mode 1 and returns its raw stdout/markdown.
  - When not installed: returns `{ source: "unavailable", urls: [] }` and logs the install hint (caller then falls back to `discoverSiteUrls`).
  - When installed: parses the skill output into a deduped list of absolute, same-origin, HTTP-200 URLs (the skill already 200-checks and drops noindex/redirected/non-canonical; this parser just extracts the final URL list it reports).
- Also exports `export function parseSeoSitemapOutput(text, origin)` → `string[]` (pure, the unit under test).

- [ ] **Step 1: Write the failing test**

Create `website-to-components/test/seo-sitemap.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeoSitemapOutput, discoverWithSeoSitemap } from "../lib/seo-sitemap.js";

test("parseSeoSitemapOutput extracts same-origin URLs and dedupes", () => {
  const text = [
    "Validated URLs (HTTP 200, indexable):",
    "- https://example.com/",
    "- https://example.com/about",
    "- https://example.com/about",          // duplicate
    "- https://other.com/x",                // different origin — dropped
    "noise line without a url",
  ].join("\n");
  const urls = parseSeoSitemapOutput(text, "https://example.com");
  assert.deepEqual(urls, ["https://example.com/", "https://example.com/about"]);
});

test("discoverWithSeoSitemap returns unavailable when skill not installed", async () => {
  const logs = [];
  const res = await discoverWithSeoSitemap({
    origin: "https://example.com",
    isInstalled: async () => false,
    runSkill: async () => { throw new Error("should not run"); },
    log: (m) => logs.push(m),
  });
  assert.equal(res.source, "unavailable");
  assert.deepEqual(res.urls, []);
  assert.ok(logs.some((m) => /claude-seo/i.test(m)));
});

test("discoverWithSeoSitemap returns parsed urls when installed", async () => {
  const res = await discoverWithSeoSitemap({
    origin: "https://example.com",
    isInstalled: async () => true,
    runSkill: async () => "- https://example.com/\n- https://example.com/pricing",
    log: () => {},
  });
  assert.equal(res.source, "seo-sitemap");
  assert.deepEqual(res.urls, ["https://example.com/", "https://example.com/pricing"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website-to-components && node --test test/seo-sitemap.test.mjs`
Expected: FAIL — `Cannot find module '../lib/seo-sitemap.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `website-to-components/lib/seo-sitemap.js`:

```javascript
// website-to-components/lib/seo-sitemap.js
//
// Whole-site URL discovery via the claude-seo `seo-sitemap` skill (Mode 1:
// "Analyze Existing Sitemap"). The skill locates sitemap.xml (with robots.txt
// and sitemap-index fallbacks), 200-checks each URL, and drops noindex /
// redirected / non-canonical URLs. This module owns invocation + parsing; all
// I/O is injected so the parser is unit-testable without the skill installed.

export function parseSeoSitemapOutput(text, origin) {
  if (!text) return [];
  const originUrl = new URL(origin);
  const seen = new Set();
  const out = [];
  // Match absolute http(s) URLs anywhere in the skill's output.
  const re = /https?:\/\/[^\s)<>"']+/gi;
  let m;
  while ((m = re.exec(text))) {
    let u;
    try { u = new URL(m[0]); } catch { continue; }
    if (u.origin !== originUrl.origin) continue;     // same-origin only
    const norm = u.href.replace(/#.*$/, "");          // drop fragment
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export async function discoverWithSeoSitemap({ origin, runSkill, isInstalled, log }) {
  if (!(await isInstalled())) {
    log("claude-seo seo-sitemap skill not installed. Install: /plugin marketplace add AgricIDaniel/claude-seo. Falling back to menu-reachable discovery.");
    return { source: "unavailable", urls: [] };
  }
  const raw = await runSkill(origin);
  const urls = parseSeoSitemapOutput(raw, origin);
  return { source: "seo-sitemap", urls };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website-to-components && node --test test/seo-sitemap.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add website-to-components/lib/seo-sitemap.js website-to-components/test/seo-sitemap.test.mjs
git commit -m "feat(migration): seo-sitemap skill wrapper + URL parser (claude-seo Mode 1)"
```

---

### Task B2: Default skill runner — `isInstalled` + `runSkill` via shell

**Files:**
- Modify: `website-to-components/lib/seo-sitemap.js`
- Test: `website-to-components/test/seo-sitemap.test.mjs` (add a test for the command builder)

**Interfaces:**
- Produces: `export function defaultSeoSitemapRunner({ execImpl })` → `{ isInstalled, runSkill }`, where `execImpl(cmd, args)` returns `Promise<{ code, stdout, stderr }>`. Default `execImpl` uses `node:child_process`. `isInstalled` checks for the skill (probe `claude` plugin presence — verify the exact probe against the live environment; the design names the marketplace `AgricIDaniel/claude-seo`). `runSkill(origin)` invokes the skill in Mode 1 and returns stdout. This is the only place that knows *how* to call claude-seo, so the exact invocation can be tuned without touching the parser or pipeline.

- [ ] **Step 1: Write the failing test (command builder is pure + injectable)**

Add to `website-to-components/test/seo-sitemap.test.mjs`:

```javascript
import { defaultSeoSitemapRunner } from "../lib/seo-sitemap.js";

test("defaultSeoSitemapRunner.runSkill passes the origin to the skill and returns stdout", async () => {
  const calls = [];
  const execImpl = async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, stdout: "- https://example.com/\n", stderr: "" };
  };
  const runner = defaultSeoSitemapRunner({ execImpl });
  const out = await runner.runSkill("https://example.com");
  assert.equal(out, "- https://example.com/\n");
  assert.ok(calls.length === 1);
  // The origin must reach the underlying command somewhere in its argv/stdin.
  const joined = JSON.stringify(calls[0]);
  assert.ok(joined.includes("https://example.com"));
});

test("defaultSeoSitemapRunner.isInstalled reflects exec success", async () => {
  const ok = defaultSeoSitemapRunner({ execImpl: async () => ({ code: 0, stdout: "seo-sitemap", stderr: "" }) });
  assert.equal(await ok.isInstalled(), true);
  const no = defaultSeoSitemapRunner({ execImpl: async () => ({ code: 1, stdout: "", stderr: "not found" }) });
  assert.equal(await no.isInstalled(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website-to-components && node --test test/seo-sitemap.test.mjs`
Expected: FAIL — `defaultSeoSitemapRunner is not exported`.

- [ ] **Step 3: Implement the runner**

Append to `website-to-components/lib/seo-sitemap.js`:

```javascript
import { spawn } from "node:child_process";

function nodeExec(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { encoding: "utf8" });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", () => resolve({ code: 1, stdout, stderr: stderr || "spawn error" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function defaultSeoSitemapRunner({ execImpl } = {}) {
  const exec = execImpl || nodeExec;

  async function isInstalled() {
    // Probe for the seo-sitemap skill. The exact discovery command depends on
    // how claude-seo is installed in this environment; adjust the probe to your
    // setup (see NOTE in the plan). Treat exit 0 + mention of the skill as ready.
    const { code, stdout } = await exec("claude", ["skill", "list"]);
    return code === 0 && /seo-sitemap/i.test(stdout);
  }

  async function runSkill(origin) {
    // Invoke seo-sitemap Mode 1 for this origin and return its stdout. The exact
    // CLI form is environment-specific; the injected execImpl keeps it swappable.
    const { stdout } = await exec("claude", [
      "skill", "run", "seo-sitemap",
      "--mode", "analyze-existing-sitemap",
      "--site", origin,
    ]);
    return stdout;
  }

  return { isInstalled, runSkill };
}
```

> NOTE for the implementer: the `claude skill list` / `claude skill run` invocation above is a placeholder for *how* claude-seo exposes `seo-sitemap` in this DDEV environment. Before relying on it, confirm the real entry point: check the claude-seo plugin's `seo-sitemap` skill for its documented CLI (it may be a Python script under the plugin dir, e.g. `python3 .../seo-sitemap/scripts/analyze_sitemap.py <url>`, rather than a `claude skill run` subcommand). Update `isInstalled`/`runSkill` to match; the parser and pipeline do not change. This is the design's open question #3 ("whether claude-seo is added as a DDEV-Canvas addon dependency or installed by the migration addon's own installer") — resolve it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website-to-components && node --test test/seo-sitemap.test.mjs`
Expected: PASS — 5 tests total in this file.

- [ ] **Step 5: Commit**

```bash
git add website-to-components/lib/seo-sitemap.js website-to-components/test/seo-sitemap.test.mjs
git commit -m "feat(migration): default claude-seo runner (isInstalled + runSkill, injectable exec)"
```

---

### Task B3: Wire seo-sitemap into whole-site discovery in run.js

**Files:**
- Modify: `website-to-components/scripts/run.js:78-95` (the `resolveDiscovery` call block)
- Modify: `website-to-components/lib/discovery.js` (accept an optional pre-validated `siteUrls` provider)
- Test: `website-to-components/test/discovery.test.mjs` (add a case for the claude-seo path)

**Interfaces:**
- Consumes: `discoverWithSeoSitemap`, `defaultSeoSitemapRunner` (Tasks B1/B2); existing `discoverSiteUrls` (`jobs/00b-sitemap-xml.js`) as the fallback.
- Produces: `resolveDiscovery` gains an optional `seoSitemap` injected function: `seoSitemap()` → `Promise<{ source, urls }>`. For `scope === "site"`: try `seoSitemap()` first; if it returns `source: "unavailable"` or zero urls, fall back to the existing `discoverSiteUrls(...)` (sitemap.xml parse → robots → menu-reachable warn). Menus are unaffected (still nav-extracted in run.js).

- [ ] **Step 1: Write the failing test**

Add to `website-to-components/test/discovery.test.mjs`:

```javascript
test("site scope prefers seo-sitemap when it returns urls", async () => {
  const res = await resolveDiscovery({
    scope: "site",
    origin: "https://example.com",
    homepageUrl: "https://example.com/",
    fetchXml: async () => null,                          // no raw sitemap
    listMenuPages: async () => ["https://example.com/menu-only"],
    seoSitemap: async () => ({ source: "seo-sitemap", urls: ["https://example.com/a", "https://example.com/b"] }),
    log: () => {},
  });
  assert.equal(res.source, "seo-sitemap");
  assert.deepEqual(res.pages, ["https://example.com/a", "https://example.com/b"]);
});

test("site scope falls back to discoverSiteUrls when seo-sitemap unavailable", async () => {
  const res = await resolveDiscovery({
    scope: "site",
    origin: "https://example.com",
    homepageUrl: "https://example.com/",
    fetchXml: async (p) => p === "/sitemap.xml"
      ? "<urlset><url><loc>https://example.com/x</loc></url></urlset>" : null,
    listMenuPages: async () => [],
    seoSitemap: async () => ({ source: "unavailable", urls: [] }),
    log: () => {},
  });
  assert.equal(res.source, "sitemap");
  assert.deepEqual(res.pages, ["https://example.com/x"]);
});
```

> The existing `discovery.test.mjs` already imports `resolveDiscovery` and `assert`; reuse those imports — do not redeclare them.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website-to-components && node --test test/discovery.test.mjs`
Expected: FAIL — `seoSitemap` is ignored, so the first test gets `source: "menus"`/`"sitemap"` not `"seo-sitemap"`.

- [ ] **Step 3: Update `resolveDiscovery`**

Edit `website-to-components/lib/discovery.js` to insert the seo-sitemap branch. Replace the `// scope === "site"` block (lines 15-17):

```javascript
  // scope === "site"
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  return { pages: result.urls, source: result.source };
```

with:

```javascript
  // scope === "site"
  // Prefer claude-seo's validated URL list (HTTP-200 + canonical). Fall back to
  // raw sitemap.xml parsing (then robots, then menu-reachable) when claude-seo is
  // unavailable or yields nothing.
  if (typeof seoSitemap === "function") {
    const seo = await seoSitemap();
    if (seo && seo.source === "seo-sitemap" && seo.urls.length) {
      return { pages: seo.urls, source: "seo-sitemap" };
    }
  }
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  return { pages: result.urls, source: result.source };
```

And add `seoSitemap` to the destructured params on line 8:

```javascript
export async function resolveDiscovery({ scope, origin, fetchXml, listMenuPages, homepageUrl, seoSitemap, log }) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website-to-components && node --test test/discovery.test.mjs`
Expected: PASS — existing 4 tests + 2 new = 6.

- [ ] **Step 5: Wire it into run.js**

In `website-to-components/scripts/run.js`, add the import near the other lib imports (after line 15):

```javascript
import { discoverWithSeoSitemap, defaultSeoSitemapRunner } from "../lib/seo-sitemap.js";
```

Then in the `resolveDiscovery({ ... })` call (lines 78-93), add a `seoSitemap` field. Insert it right after the `listMenuPages: async () => { ... }` block and before `log:`:

```javascript
  seoSitemap: scope === "site"
    ? async () => {
        const runner = defaultSeoSitemapRunner();
        return discoverWithSeoSitemap({
          origin,
          isInstalled: runner.isInstalled,
          runSkill: runner.runSkill,
          log: (m) => console.log(m),
        });
      }
    : undefined,
```

- [ ] **Step 6: Run the full test suite**

Run: `cd website-to-components && node --test test/*.test.mjs`
Expected: PASS — all prior tests plus the new seo-sitemap (5) and discovery (2) tests. No regressions.

- [ ] **Step 7: Commit**

```bash
git add website-to-components/lib/discovery.js website-to-components/scripts/run.js website-to-components/test/discovery.test.mjs
git commit -m "feat(migration): use claude-seo seo-sitemap for whole-site discovery, fall back to raw parse"
```

---

### Task B4: Make claude-seo a documented install dependency

**Files:**
- Modify: `install.yaml` (post-install echo already mentions claude-seo — strengthen wording)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: install output and README clearly state claude-seo is required for `--scope site` and that the migration uses its `seo-sitemap` skill Mode 1; without it, `--scope site` falls back to raw sitemap parsing then menu-reachable.

- [ ] **Step 1: Strengthen install.yaml messaging**

In `install.yaml`, the existing post-install lines say claude-seo is needed for whole-site. Replace:

```yaml
    - "echo 'Without it, --scope site falls back to menu-reachable pages.'"
```

with:

```yaml
    - "echo 'It is used via the seo-sitemap skill (Mode 1) for HTTP-200-validated, canonical whole-site discovery.'"
    - "echo 'Without it, --scope site falls back to raw sitemap.xml parsing, then menu-reachable pages.'"
```

- [ ] **Step 2: Document in README.md**

Add to `README.md` under whole-site usage:

```markdown
### Whole-site scope and claude-seo

`ddev clone <url> --scope site` discovers pages via the
[claude-seo](https://github.com/AgricIDaniel/claude-seo) `seo-sitemap` skill in
Mode 1 ("Analyze Existing Sitemap"): it locates `sitemap.xml` (with
`sitemap_index.xml` and `robots.txt` fallbacks), validates each URL returns
HTTP 200, and drops noindex / redirected / non-canonical URLs.

Install it first:

    /plugin marketplace add AgricIDaniel/claude-seo
    /plugin install

If claude-seo is not installed, `--scope site` falls back to raw `sitemap.xml`
parsing and then to menu-reachable discovery (with a warning). Menus are always
derived from on-page navigation, never from the sitemap.
```

- [ ] **Step 3: Verify install.yaml is still valid**

Run: `cd /Users/nickopris/Work/fg/projects/ddev-addons/DDEV-migration-addon && node -e "const y=require('fs').readFileSync('install.yaml','utf8'); console.log(y.includes('seo-sitemap skill') ? 'OK' : 'MISSING')"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add install.yaml README.md
git commit -m "docs(migration): claude-seo required for whole-site (seo-sitemap Mode 1) + fallback chain"
```

---

## Self-Review

**Spec coverage (design 2026-06-24, against this plan):**

- Decision 1 (interactive scope prompt) — already implemented (`lib/scope.js`); not in this plan by design. ✓ covered pre-existing.
- Decision 2 (auto menus) — already implemented (`lib/menu.js`, `run.js` nav extraction). ✓ pre-existing.
- Decision 3 (auto-push on green) — already implemented (`lib/push-local.js`). ✓ pre-existing.
- Decision 4 (full local sync) — already implemented (push components→menus→pages→publish). ✓ pre-existing.
- **Decision 5 (auto-bootstrap perms, idempotent)** — **Gap A, Tasks A1–A4.** ✓ this plan.
- Whole-site no-sitemap fallback — preserved in B3 (falls through to `discoverSiteUrls`). ✓.
- **claude-seo seo-sitemap Mode 1 requirement** — **Gap B, Tasks B1–B4.** ✓ this plan.
- Re-run upsert/skip+warn — already implemented (`push-pages.js`, `bundleHasRevisions`). ✓ pre-existing. Bootstrap A1 enables revisions so upsert is the normal path. ✓.
- Subsystem 1a sub-points: JSON:API write (A1), OAuth client (A2), **service user assigned** (A2), page revisions default (A1), write `.env` keys (A3). ✓ all covered.
- Subsystem 2 whole-site: seo-sitemap Mode 1 (B1–B3), menus-from-nav preserved (run.js untouched for menus). ✓.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" left. Two explicit `NOTE for the implementer` blocks (A2 consumer field names, B2 claude-seo CLI form) intentionally flag environment-specific verification the design itself listed as open questions — each gives a concrete probe command and a default, not a blank. Bootstrap PHP (A1/A2) has no unit test by design (Drupal-runtime glue) and instead carries explicit run-twice idempotency checks.

**Type consistency:** `discoverWithSeoSitemap`/`parseSeoSitemapOutput`/`defaultSeoSitemapRunner` signatures match between definition (B1/B2) and use (B3). `resolveDiscovery` gains `seoSitemap` param consistently in `discovery.js` and the `run.js` call site. Env keys `CANVAS_LOCAL_SITE_URL`/`CANVAS_LOCAL_CLIENT_ID`/`CANVAS_LOCAL_CLIENT_SECRET` and scope string match `lib/bootstrap-check.js` and `lib/jsonapi.js` verbatim. Return shape `{ source, urls }` consistent across seo-sitemap and `discoverSiteUrls`.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
