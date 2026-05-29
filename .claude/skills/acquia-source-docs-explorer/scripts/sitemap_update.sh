#!/usr/bin/env bash
# Updates the Acquia Source documentation sitemap by filtering the full
# docs.acquia.com sitemap to only acquia-source pages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT="$SKILL_DIR/acquia-source-sitemap.xml"
SITEMAP_URL="https://docs.acquia.com/sitemap.xml"

echo "Fetching sitemap from $SITEMAP_URL..."
FULL_SITEMAP=$(curl -s "$SITEMAP_URL")

echo "Filtering to acquia-source pages..."
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  echo "$FULL_SITEMAP" \
    | tr '\n' ' ' \
    | grep -oP '<url>.*?</url>' \
    | grep 'docs\.acquia\.com/acquia-source/' \
    | sed 's|<url>|  <url>\n   |g; s|</url>|  </url>|g; s|<loc>| <loc>|g; s|<lastmod>|\n    <lastmod>|g; s|<changefreq>|\n    <changefreq>|g; s|<priority>|\n    <priority>|g'
  echo '</urlset>'
} > "$OUTPUT"

COUNT=$(grep -c '<loc>' "$OUTPUT")
echo "Done. $COUNT acquia-source pages written to $OUTPUT"
