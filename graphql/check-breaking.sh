#!/usr/bin/env bash
# Fails if <revision> SDL has breaking changes compared to <base> SDL.
# Usage: graphql/check-breaking.sh <base.graphql> <revision.graphql>
# GraphQL Inspector classifies each change as breaking, dangerous or safe,
# and exits non-zero only for breaking ones.
set -euo pipefail
npx --no-install graphql-inspector diff "$1" "$2"
