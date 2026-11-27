#!/usr/bin/env bash
# Fails (exit 1) if <revision> has breaking changes compared to <base>.
# Usage: tests/breaking-changes/check.sh <base-spec> <revision-spec>
# Uses a local oasdiff if installed, otherwise the pinned Docker image (as CI does).
set -euo pipefail

base="$1"
revision="$2"

if command -v oasdiff >/dev/null 2>&1; then
  oasdiff=(oasdiff)
else
  oasdiff=(docker run --rm -v "$PWD:/work" -w /work "${OASDIFF_IMAGE:-tufin/oasdiff:v1.38.0}")
fi

# --fail-on ERR: only changes oasdiff classifies as breaking fail the build;
# warnings (for example a new optional field) are printed but allowed.
"${oasdiff[@]}" breaking "$base" "$revision" --fail-on ERR
