#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec deno run --allow-read --allow-write --allow-env --allow-run \
  "$SCRIPT_DIR/run-agent.ts" --agent codex "$@"
