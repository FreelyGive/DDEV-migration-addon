// website-to-components/lib/push-local.js
import { pushPages } from "./push-pages.js";
import { checkLocalReady } from "./bootstrap-check.js";

export async function pushToLocal({ env, menus, pages, runCanvasPush, client, log }) {
  const ready = await checkLocalReady({
    env,
    probeToken: async (scope) => {
      if (typeof client.getToken !== "function") return "ok";
      return client.getToken(scope).catch(() => null);
    },
  });
  if (!ready.ok) {
    return { ok: false, report: ready.problems.join("\n") };
  }

  log("→ Pushing components to local site …");
  await runCanvasPush();

  log("→ Creating menus …");
  let menuCount = 0;
  for (const [menuName, links] of Object.entries({ main: menus.main, footer: menus.footer, sidebar: menus.sidebar })) {
    let weight = 0;
    for (const link of links) {
      await client.upsertMenuLink({ menu: menuName, title: link.label, url: link.href, weight: weight++ });
      menuCount++;
    }
  }

  log("→ Creating pages …");
  const result = await pushPages({ client, pages, log });

  const reviewUrl = env.CANVAS_LOCAL_SITE_URL;
  const report = [
    `Pushed components, ${menuCount} menu links, and pages to the local site.`,
    `  created: ${result.created.length}  updated: ${result.updated.length}  skipped: ${result.skipped.length}`,
    `Live at ${reviewUrl}`,
  ].join("\n");
  log(report);
  return { ok: true, report };
}
