const REQUIRED = ["CANVAS_LOCAL_SITE_URL", "CANVAS_LOCAL_CLIENT_ID", "CANVAS_LOCAL_CLIENT_SECRET"];

export async function checkLocalReady({ env, probeToken }) {
  const problems = [];
  for (const key of REQUIRED) {
    if (!env[key]) problems.push(`Missing ${key} in storybook/.env — run \`ddev canvas-bootstrap\` (idempotent) to populate it.`);
  }
  if (problems.length) return { ok: false, problems };

  const token = await probeToken("canvas:asset_library canvas:js_component");
  if (!token) {
    problems.push("OAuth token request failed for the local site. Run `ddev canvas-bootstrap` to (re)create the consumer, or check it at /admin/config/services/consumer: Client Credentials grant enabled, scopes canvas:asset_library + canvas:js_component, and a Drupal user assigned (missing user → 401).");
    return { ok: false, problems };
  }
  return { ok: true, problems: [] };
}
