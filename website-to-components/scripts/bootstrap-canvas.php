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
