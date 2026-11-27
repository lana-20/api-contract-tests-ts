#!/usr/bin/env bash
# Proves the GraphQL gate works both ways: unchanged schema passes, a broken one fails.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=".inspector-tmp"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

echo "== unchanged schema: expect no breaking changes"
graphql/check-breaking.sh graphql/schema.graphql graphql/schema.graphql

echo "== broken schema: remove Contact.email, expect a breaking change"
grep -v '^  email: String!$' graphql/schema.graphql > "$tmp/broken.graphql"
status=0
graphql/check-breaking.sh graphql/schema.graphql "$tmp/broken.graphql" | tee "$tmp/report.txt" || status=$?
if [[ $status -eq 0 ]] || ! grep -q "Field email was removed from object type Contact" "$tmp/report.txt"; then
  echo "FAIL: GraphQL Inspector did not report the removed field" >&2
  exit 1
fi
echo "OK: GraphQL Inspector blocked the breaking change"
