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

// 3. OAuth consumer: reuse or create.
//
// A consumer is "usable" iff it has the client_credentials grant AND an
// assigned user. Scopes are NOT checked — they are validated at token time
// against oauth2_scope entities, not stored on the consumer. Do NOT set
// scopes or is_default on create.

$is_usable = function ($consumer): bool {
  $grants = array_column($consumer->get('grant_types')->getValue(), 'value');
  if (!in_array('client_credentials', $grants, TRUE)) {
    return FALSE;
  }
  $user_field = $consumer->get('user_id')->getValue();
  return !empty($user_field);
};

$consumer_storage = \Drupal::entityTypeManager()->getStorage('consumer');
$existing = $consumer_storage->loadMultiple();

$usable = NULL;
foreach ($existing as $c) {
  if ($is_usable($c)) {
    $usable = $c;
    break;
  }
}

$result_client_id     = '';
$result_client_secret = '__keep__';

if ($usable !== NULL) {
  $result_client_id = $usable->get('client_id')->value;
  bootstrap_log('Reusing existing usable consumer: ' . $result_client_id . ' (label: ' . $usable->label() . ')');
}
else {
  // Create a new consumer. Generate a random plaintext secret, then save.
  $plaintext_secret = bin2hex(random_bytes(24));
  $new_consumer = $consumer_storage->create([
    'client_id'   => 'canvas-ai-' . substr(bin2hex(random_bytes(3)), 0, 6),
    'label'       => 'Canvas AI (bootstrap)',
    'grant_types' => [['value' => 'client_credentials']],
    'user_id'     => ['target_id' => 1],
    'secret'      => $plaintext_secret,
    'confidential' => TRUE,
    'status'      => TRUE,
  ]);
  try {
    $new_consumer->save();
    $result_client_id     = $new_consumer->get('client_id')->value;
    $result_client_secret = $plaintext_secret;
    bootstrap_log('Created new consumer: ' . $result_client_id);
  }
  catch (EntityStorageException $e) {
    // Fail loudly: do NOT fall through to emit a [bootstrap-result] line, or
    // the caller (ddev canvas-bootstrap) would treat a failed create as success
    // and write an empty client_id into .env. Exit non-zero instead.
    bootstrap_log('ERROR: could not create consumer — ' . $e->getMessage());
    exit(1);
  }
}

// Emit the machine-readable result line consumed by ddev canvas-bootstrap (Task A3).
$site_url = getenv('DDEV_PRIMARY_URL') ?: '__keep__';
$result = json_encode([
  'client_id'       => $result_client_id,
  'client_secret'   => $result_client_secret,
  'site_url'        => $site_url,
  'jsonapi_prefix'  => 'jsonapi',
]);
fwrite(STDOUT, "[bootstrap-result] $result\n");
