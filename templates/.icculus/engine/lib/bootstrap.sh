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
ICCULUS_ENGINE=${ICCULUS_ENGINE:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
ICCULUS_LIB="$ICCULUS_ENGINE/lib"
ICCULUS_ROOT=${ICCULUS_ROOT:-$(CDPATH= cd -- "$ICCULUS_ENGINE/../.." && pwd)}
ICCULUS_TOML=${ICCULUS_TOML:-$ICCULUS_ROOT/icculus.toml}
export ICCULUS_ENGINE ICCULUS_LIB ICCULUS_ROOT ICCULUS_TOML

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

# Coding agents set ICCULUS_AGENT=1 (analogous to the donor's AI_AGENT=agent) to
# request compact, machine-friendly tool output. Slot commands may read it.
export ICCULUS_AGENT=${ICCULUS_AGENT:-${AI_AGENT:+1}}
