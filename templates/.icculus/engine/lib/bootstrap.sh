# shellcheck shell=sh
# bootstrap.sh — recipe preamble. Every engine recipe sources this first:
#
#   #!/usr/bin/env sh
#   # desc: ...
#   . "$(dirname "$0")/lib/bootstrap.sh"
#
# It resolves the harness paths and loads the shared libraries. When a recipe is
# invoked through `bin/agent`, the ICCULUS_* variables are already exported and
# reused; when a recipe is run directly by path, they are derived from this
# file's location so the recipe still works standalone.

# Engine dir = the directory holding the recipe that sourced us ($0). lib/ sits
# inside it; the project root is two levels up from the engine dir.
ICCULUS_ENGINE=${ICCULUS_ENGINE:-$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)}
ICCULUS_LIB="$ICCULUS_ENGINE/lib"
ICCULUS_ROOT=${ICCULUS_ROOT:-$(CDPATH='' cd -- "$ICCULUS_ENGINE/../.." && pwd)}
ICCULUS_TOML=${ICCULUS_TOML:-$ICCULUS_ROOT/icculus.toml}
export ICCULUS_ENGINE ICCULUS_LIB ICCULUS_ROOT ICCULUS_TOML

# Disable pathname expansion (globbing) for the entire engine. Recipes word-split
# config values out of `config_array` in unquoted `for` loops; with globbing on,
# a scope pattern like "app/**" expands against the working tree and silently
# drops nested paths from their scope (see ADR 0012). No engine recipe needs
# globbing; one that genuinely does opts back in locally with `set +f`. This
# affects only filename generation — case-matching and ${var} expansion are not.
set -f

if [ ! -f "$ICCULUS_TOML" ]; then
    printf 'icculus: no icculus.toml found at %s\n' "$ICCULUS_TOML" >&2
    exit 1
fi

# shellcheck source=output.sh
. "$ICCULUS_LIB/output.sh"
# shellcheck source=config.sh
. "$ICCULUS_LIB/config.sh"
# shellcheck source=jobs.sh
. "$ICCULUS_LIB/jobs.sh"

# Resolve the integration branch once and export it, so the standalone git
# utilities (assert-main-merged, changed-scopes, prune-git-worktrees, …) all see
# the same value. Precedence: an explicit MAIN_BRANCH env override wins; else the
# config value [project].main_branch; else "main".
export MAIN_BRANCH="${MAIN_BRANCH:-$(config_get project.main_branch main)}"

# Coding agents set ICCULUS_AGENT=1 (analogous to a conventional agent env flag)
# to request compact, machine-friendly tool output. Slot commands may read it.
# The fallback below also honours a conventional agent flag if one is already set.
export ICCULUS_AGENT="${ICCULUS_AGENT:-${AI_AGENT:+1}}"
