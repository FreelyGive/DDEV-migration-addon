const REQUIRED = ["CANVAS_LOCAL_SITE_URL", "CANVAS_LOCAL_CLIENT_ID", "CANVAS_LOCAL_CLIENT_SECRET"];

export async function checkLocalReady({ env, probeToken }) {
  const problems = [];
  for (const key of REQUIRED) {
    if (!env[key]) problems.push(`Missing ${key} in storybook/.env — re-run the fresh-Drupal install or fill it manually (see canvas-push-local skill).`);
  }
  if (problems.length) return { ok: false, problems };

  const token = await probeToken("canvas:asset_library canvas:js_component");
  if (!token) {
    problems.push("OAuth token request failed for the local site. Check the canvas_oauth client at /admin/config/services/consumer: Client Credentials grant enabled, scopes canvas:asset_library + canvas:js_component, and a Drupal user assigned (missing user → 401).");
    return { ok: false, problems };
  }
  return { ok: true, problems: [] };
}
