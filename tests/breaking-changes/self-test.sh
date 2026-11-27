#!/usr/bin/env bash
# Proves the gate works both ways:
#   the spec compared with itself must pass, and a deliberately broken copy must fail.
set -euo pipefail
cd "$(dirname "$0")/../.."

tmp=".oasdiff-tmp"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

echo "== unchanged spec: expect no breaking changes"
tests/breaking-changes/check.sh openapi/openapi.yaml openapi/openapi.yaml

echo "== broken spec: expect breaking changes"
npx tsx tests/breaking-changes/make-breaking-spec.ts "$tmp/openapi.breaking.yaml"
status=0
tests/breaking-changes/check.sh openapi/openapi.yaml "$tmp/openapi.breaking.yaml" | tee "$tmp/report.txt" || status=$?

# Check the exit code AND the findings: a crash (for example an unreadable spec)
# also exits non-zero, and must not count as "the gate works".
if [[ $status -ne 1 ]]; then
  echo "FAIL: expected exit code 1 from oasdiff, got $status" >&2
  exit 1
fi
for expected in response-required-property-removed new-required-request-property api-removed; do
  grep -q "$expected" "$tmp/report.txt" || { echo "FAIL: oasdiff did not report $expected" >&2; exit 1; }
done
echo "OK: oasdiff blocked all three breaking changes"
