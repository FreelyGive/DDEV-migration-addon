// website-to-components/lib/push-pages.js
export async function pushPages({ client, pages, log }) {
  const created = [], updated = [], skipped = [];
  const revisionsOn = await client.bundleHasRevisions("page");
  for (const page of pages) {
    const existing = await client.findPageByPath(page.path);
    if (!existing) {
      await client.createPage(page);
      created.push(page.path);
    } else if (revisionsOn) {
      await client.updatePage(existing.id, page);
      updated.push(page.path);
    } else {
      log(`Skipping ${page.path}: page exists and revisions disabled on 'page' bundle (would overwrite irrecoverably).`);
      skipped.push(page.path);
    }
  }
  return { created, updated, skipped };
}
